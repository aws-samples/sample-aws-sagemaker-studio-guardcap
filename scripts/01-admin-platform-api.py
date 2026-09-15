"""Admin API + sync jobs for the GPU platform, one Lambda. Reads the platform template's config via SSM, never writes back."""

""" IMPORTS """
import json
import os
import sys
import traceback
import uuid

from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from functools import cache, wraps
from types import SimpleNamespace
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError


""" ENVIRONMENT VARIABLES : set by the platform template. ADMIN_PREFIX prefixes this system's own
SSM path and stack names.

.get(), never os.environ[...]: a KeyError out here fires at IMPORT, killing the module with an
opaque "Unable to import module" and no hint which var. guarded() reports these as a 500. """

ADMIN_PREFIX                    = os.environ.get('ADMIN_PREFIX', 'gpu-guardian')
ADMIN_ACCOUNT_ID                = os.environ.get('ADMIN_ACCOUNT_ID', '')
ADMIN_GROUP_ID                  = os.environ.get('ADMIN_GROUP_ID', '')
ADMIN_ALERTS_TOPIC_ARN          = os.environ.get('ADMIN_ALERTS_TOPIC_ARN', '')
STUDENT_STACK_DEPLOY_ROLE_ARN   = os.environ.get('STUDENT_STACK_DEPLOY_ROLE_ARN', '')
STUDENTS_TABLE                  = os.environ.get('STUDENTS_TABLE_NAME', '')
ALARM_EVENTS_TABLE              = os.environ.get('ALARM_EVENTS_TABLE_NAME', '')

""" METERING : the cap is enforced by this Lambda, not by AWS Budgets.

USAGE_LEDGER_TABLE  : the consumption ledger. Its PERIOD# row IS the spend figure the cap is
                      compared against - see LedgerStore.
CONSUMPTION_LOG_GROUP: append-only audit trail, one JSON line per metered sample.
CLASS_POOL_CAP_USD  : class-wide backstop, notify-only. 0 disables it.
SWEEP_MINUTES       : the EventBridge cadence of usage_sync, passed in rather than assumed because
                      it is exactly the worst-case overshoot window, which the student page and
                      the breach message both quote. """

USAGE_LEDGER_TABLE              = os.environ.get('USAGE_LEDGER_TABLE_NAME', '')
CONSUMPTION_LOG_GROUP           = os.environ.get('CONSUMPTION_LOG_GROUP', '')
CLASS_POOL_CAP_USD              = float(os.environ.get('CLASS_POOL_CAP_USD') or 0)
SWEEP_MINUTES                   = int(os.environ.get('SWEEP_MINUTES') or 5)

""" BRANDING : served by GET /init, the one unauthenticated route.

Cosmetic values plus the public sign-in coordinates only, which is what lets that route be open:
a Cognito pool ID, client ID and hosted-UI domain all end up in a URL bar before anyone has
logged in. Nothing about the Studio domain, the roster or any ARN belongs here - see api_init.
Unset values fall back to AWS naming and the AWS logo. """

APP_TITLE                       = os.environ.get('APP_TITLE', '').strip()
APP_SHORT_NAME                  = os.environ.get('APP_SHORT_NAME', '').strip()
APP_LOGO_URL                    = os.environ.get('APP_LOGO_URL', '').strip()
APP_FAVICON_URL                 = os.environ.get('APP_FAVICON_URL', '').strip()
APP_PRIMARY_COLOR               = os.environ.get('APP_PRIMARY_COLOR', '').strip()
APP_INSTITUTION_NAME            = os.environ.get('APP_INSTITUTION_NAME', '').strip()
APP_SUPPORT_EMAIL               = os.environ.get('APP_SUPPORT_EMAIL', '').strip()
COGNITO_CLIENT_ID               = os.environ.get('COGNITO_CLIENT_ID', '')
COGNITO_HOSTED_UI_DOMAIN        = os.environ.get('COGNITO_HOSTED_UI_DOMAIN', '')
FRONTEND_URL                    = os.environ.get('FRONTEND_URL', '')

""" IDENTITY MODE : which kind of IAM Identity Center instance the platform was deployed against.
ORGANIZATION means the domain is AuthMode SSO and IdC is the roster; ACCOUNT means AuthMode IAM
and Cognito is the roster for admins and students both. docs/ARCHITECTURE.md section 7.

Set from IdentityCenterInstanceType in the platform template, so it can never disagree with the
AuthMode the domain was created with. The cost cap is mode-independent: the identity plumbing
branches in exactly one place, the Directory alias below. """

IDENTITY_MODE                   = os.environ.get('IDENTITY_MODE', '').strip().upper()
DOMAIN_AUTH_MODE                = os.environ.get('DOMAIN_AUTH_MODE', '').strip().upper()
COGNITO_USER_POOL_ID            = os.environ.get('COGNITO_USER_POOL_ID', '')
COGNITO_ADMIN_GROUP             = os.environ.get('COGNITO_ADMIN_GROUP', '')
COGNITO_STUDENT_GROUP           = os.environ.get('COGNITO_STUDENT_GROUP', '')

IS_ORG_MODE                     = IDENTITY_MODE == 'ORGANIZATION'

# Opt-in: ~10 API calls, so it does not tax every cold start. __main__ always runs it.
RUN_PREFLIGHT                   = os.environ.get('RUN_PREFLIGHT', '').strip().lower() in ('1', 'true', 'yes')

MISSING_ENV = sorted(n for n in (
    'ADMIN_ACCOUNT_ID', 'ADMIN_ALERTS_TOPIC_ARN',
    'STUDENT_STACK_DEPLOY_ROLE_ARN', 'STUDENTS_TABLE_NAME', 'ALARM_EVENTS_TABLE_NAME',
    # Neither is optional: a deploy that quietly ran with metering disabled would look
    # healthy while every student ran uncapped.
    'USAGE_LEDGER_TABLE_NAME', 'CONSUMPTION_LOG_GROUP',
    # Mode-independent: both modes need the pool, and an unset IDENTITY_MODE must never
    # fall through to a default - the wrong one creates identities in the wrong directory.
    'IDENTITY_MODE', 'DOMAIN_AUTH_MODE', 'COGNITO_USER_POOL_ID',
    'COGNITO_ADMIN_GROUP', 'COGNITO_STUDENT_GROUP',
    # ORGANIZATION-only: no such group exists in ACCOUNT mode, so listing it
    # unconditionally would 500 every request in a working ACCOUNT deploy.
    *(('ADMIN_GROUP_ID',) if IS_ORG_MODE else ()),
) if not os.environ.get(n))

if IDENTITY_MODE and IDENTITY_MODE not in ('ORGANIZATION', 'ACCOUNT'):
    # Not a MISSING_ENV entry: it IS set, just to something IS_ORG_MODE would read as ACCOUNT.
    MISSING_ENV = sorted({*MISSING_ENV, f'IDENTITY_MODE (invalid: {IDENTITY_MODE!r})'})


""" GLOBAL VARIABLES: These are common variables that are used across the functions """

SSM_PREFIX          = f'/{ADMIN_PREFIX}-admin/'
STACK_NAME_PREFIX   = f'{ADMIN_PREFIX}-student-'
MANAGED_BY_TAG      = f'{ADMIN_PREFIX}-gpu-lab-admin'

RUNNING_STATUSES    = frozenset({'Pending', 'InService'})
FAILED_STATUSES     = frozenset({'CREATE_FAILED', 'ROLLBACK_COMPLETE', 'UPDATE_ROLLBACK_COMPLETE'})
ACTIVE_STATUSES     = frozenset({'ACTIVE', 'ON_HOLD'})

# Our own value in directoryStatus, which otherwise holds whatever the directory reports.
# Neither service has a "deleted" status - a deleted user simply stops existing - so the
# sweep records the absence itself. Also the idempotence latch: once set, _login_was_deleted
# stops firing and ops is not alerted every five minutes.
DIRECTORY_DELETED   = 'DELETED'

DEFAULT_INSTANCE_TYPE   = 'ml.t3.medium'
DEFAULT_BUDGET_USD      = 80
WARNING_THRESHOLD_PCT   = 80
BREACH_THRESHOLD_PCT    = 100
SPEND_HISTORY_MAX_DAYS  = 14

""" NOTEBOOK RATES : us-east-1 Studio JupyterLab on-demand list prices, usage type
USE1-Studio:JupyterLab-<instance>, pulled from the Price List API on 2026-08-24 and tabulated in
docs/COSTING.md §3. These are the only types the student template's InstanceType permits, so an
unknown type here means the template changed and this map did not.

Hardcoded rather than fetched: pricing:GetProducts on the hot path would be a network call for a
number that changes once a year, and a pricing outage would silently stop metering. RATES_ASOF
makes the staleness auditable, and the rate is carried into every consumption record. """

RATES_ASOF              = '2026-08-24'
NOTEBOOK_HOURLY_USD     = {
    'ml.t3.medium'      : 0.0500,
    'ml.g4dn.xlarge'    : 0.7364,
    'ml.g6.xlarge'      : 1.1270,
    'ml.g5.xlarge'      : 1.4100,
}
# Metering an unrecognised type at $0 would be a silent hole in the cap. Bill the most
# expensive known rate instead: over-charging is a visible error, under-charging is not.
UNKNOWN_INSTANCE_HOURLY_USD = max(NOTEBOOK_HOURLY_USD.values())

LEDGER_TTL_DAYS         = 120        # SESSION# rows only; PERIOD# rows are the audit trail and never expire
SESSION_ACTIVE          = 'ACTIVE'
SESSION_CLOSED          = 'CLOSED'

# Why a hold was placed, so the month-rollover reset knows what it is allowed to lift.
# Only BUDGET holds clear themselves; a manual suspension or a deleted login must survive.
HOLD_BUDGET             = 'BUDGET'
HOLD_MANUAL             = 'MANUAL'
HOLD_DIRECTORY          = 'DIRECTORY'

# GET /init fallbacks, so an unbranded deploy renders coherently. Hotlinking
# a0.awsstatic.com is fine for a teaching console; anything customer-facing should
# set APP_LOGO_URL to an asset it hosts itself.
DEFAULT_LOGO_URL        = 'https://a0.awsstatic.com/libra-css/images/logos/aws_logo_smile_1200x630.png'
DEFAULT_FAVICON_URL     = 'https://a0.awsstatic.com/libra-css/images/site/fav/favicon.ico'
DEFAULT_PRIMARY_COLOR   = '#0972d3'                 # Cloudscape's own action blue

SUCCESS     = "🟢"
FAIL        = "🟡"
ERROR       = "🔴"
INFO        = "🔵"


""" HELPER CLASSES """

class DecimalEncoder(json.JSONEncoder):
    def default(self, o):  # param name must match JSONEncoder.default
        if isinstance(o, Decimal):
            return int(o) if o % 1 == 0 else float(o)
        return super().default(o)


""" 1. INFRASTRUCTURE """

@cache
def aws(service):
    """Lazy per-container client - a cold start shouldn't build clients it never calls."""
    return boto3.client(service)

@cache
def table(name):
    dynamodb: Any = boto3.resource('dynamodb')  # Any: .Table() only exists on the runtime resource
    return dynamodb.Table(name)

@contextmanager
def tolerate(*codes):
    """Swallow these ClientError codes, re-raise the rest. Every idempotent AWS call here uses it."""
    try:
        yield
    except ClientError as e:
        if e.response['Error']['Code'] not in codes:
            raise

def reply(status_code, body):
    return {'statusCode' : status_code,
            'headers'    : {'Content-Type': 'application/json'},
            'body'       : json.dumps(body, cls=DecimalEncoder)}

def now_iso():
    return datetime.now(timezone.utc).isoformat()

def parse_iso(value):
    """ISO-8601 string -> aware datetime, or None. Tolerant on purpose: our own now_iso() output,
    boto3's already-parsed datetimes and hand-edited DynamoDB rows all arrive here, and a
    malformed timestamp must not take the whole sweep down.
    """
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)

def period_of(when=None):
    """The billing period key, YYYY-MM in UTC. The monthly reset is structural: on the 1st the new
    PERIOD# row does not exist yet, so spend reads as zero without anything having to run.
    """
    return (when or datetime.now(timezone.utc)).strftime('%Y-%m')

def day_of(when=None):
    return (when or datetime.now(timezone.utc)).strftime('%Y-%m-%d')

def usd(amount):
    """Decimal to the cent, for DynamoDB. float is not storable and full precision is noise."""
    return Decimal(str(round(float(amount), 4)))

def claims(event):
    authorizer = event.get('requestContext', {}).get('authorizer') or {}
    return (authorizer.get('jwt') or {}).get('claims') or {}

def caller_identity(event):
    return claims(event).get('email', 'unknown')

@cache
def ssm_get(name):
    """Reads {SSM_PREFIX}<name>. Set out-of-band at bootstrap, never by redeploying, so caching is safe."""
    return aws('ssm').get_parameter(Name=f'{SSM_PREFIX}{name}')['Parameter']['Value']

@cache
def ssm_get_optional(name):
    """As ssm_get, but None instead of ParameterNotFound - for the three Identity Center
    parameters the template writes only in ORGANIZATION mode. Narrow on purpose: only a genuinely
    absent parameter is swallowed, so a permissions problem or a typo still raises rather than
    reading as "not deployed in this mode".
    """
    try:
        return ssm_get(name)
    except aws('ssm').exceptions.ParameterNotFound:
        return None

def store_id():
    return ssm_get('identity-store-id')


""" 2. PREFLIGHT : TEST PERMISSIONS FOR AWS SERVICES """

class AWSBoto3Permissions:
    """Ping every client this Lambda depends on, so a missing IAM permission or an unbootstrapped
    SSM path is one legible report rather than a 500 from whichever route was called first.

    Mandatory [M] failing means no route can work. Optional [O] is a service whose real permission
    is a WRITE that cannot be probed without side effects, so a cheap read on the same service
    stands in - it may legitimately be absent while the write is present, hence never fatal.
    """

    def __init__(self):
        # `params` may be a zero-arg callable, resolved inside _check's try, for probes whose
        # arguments come from SSM - store_id() must not raise out of __init__. `service` is a
        # name, not a client, so the probe reuses the cached client the handlers will use.
        self.aws_services: dict[str, dict[str, Any]] = {
            "sts": {
                "name"      : "STS",
                "service"   : "sts",
                "action"    : "get_caller_identity",
                "params"    : None,
                "status"    : False,
                "reqd"      : True
            },
            "ssm": {
                "name"      : "Systems Manager (bootstrap parameters)",
                "service"   : "ssm",
                "action"    : "get_parameter",
                # existing-domain-id as the canary, not identity-store-id: the latter exists
                # only in ORGANIZATION mode, so probing it would report "no SSM access" on a
                # healthy ACCOUNT deploy.
                "params"    : {"Name": f'{SSM_PREFIX}existing-domain-id'},
                "status"    : False,
                "reqd"      : True
            },
            # Mandatory only in ORGANIZATION mode, where the identity store is the roster.
            # Mirror-image for the Cognito row below.
            "identitystore": {
                "name"      : f"Identity Center (identity store){'' if IS_ORG_MODE else ' - unused in ACCOUNT mode'}",
                "service"   : "identitystore",
                "action"    : "list_users",
                "params"    : lambda: {"IdentityStoreId": store_id(), "MaxResults": 1},
                "status"    : False,
                "reqd"      : IS_ORG_MODE
            },
            "cognito": {
                "name"      : f"Cognito user pool (roster + authZ){' - sign-in bridge only in ORGANIZATION mode' if IS_ORG_MODE else ''}",
                "service"   : "cognito-idp",
                "action"    : "list_users",
                "params"    : {"UserPoolId": COGNITO_USER_POOL_ID, "Limit": 1},
                "status"    : False,
                "reqd"      : not IS_ORG_MODE
            },
            "dynamodb_students": {
                "name"      : "DynamoDB - students table",
                "service"   : "dynamodb",
                "action"    : "describe_table",
                "params"    : {"TableName": STUDENTS_TABLE},
                "status"    : False,
                "reqd"      : True
            },
            "dynamodb_alarms": {
                "name"      : "DynamoDB - alarm events table",
                "service"   : "dynamodb",
                "action"    : "describe_table",
                "params"    : {"TableName": ALARM_EVENTS_TABLE},
                "status"    : False,
                "reqd"      : True
            },
            "cloudformation": {
                "name"      : "CloudFormation",
                "service"   : "cloudformation",
                "action"    : "list_stacks",
                "params"    : None,
                "status"    : False,
                "reqd"      : True
            },
            "dynamodb_ledger": {
                "name"      : "DynamoDB - usage ledger table (the cap is enforced from this)",
                "service"   : "dynamodb",
                "action"    : "describe_table",
                "params"    : {"TableName": USAGE_LEDGER_TABLE},
                "status"    : False,
                "reqd"      : True
            },
            # Mandatory: without it there is no audit trail behind a suspension. Metering
            # itself degrades to print() (see ConsumptionLog), so enforcement still works.
            "logs": {
                "name"      : "CloudWatch Logs - consumption audit trail",
                "service"   : "logs",
                "action"    : "describe_log_streams",
                "params"    : {"logGroupName": CONSUMPTION_LOG_GROUP, "limit": 1},
                "status"    : False,
                "reqd"      : True
            },
            "iam": {
                "name"      : "IAM (enforcement needs attach/detach - write, unprobeable)",
                "service"   : "iam",
                "action"    : "list_roles",
                "params"    : {"MaxItems": 1},
                "status"    : False,
                "reqd"      : False
            },
            "lambda": {
                "name"      : "Lambda (enforcement needs Invoke - write, unprobeable)",
                "service"   : "lambda",
                "action"    : "list_functions",
                "params"    : {"MaxItems": 1},
                "status"    : False,
                "reqd"      : False
            },
            "sagemaker": {
                "name"      : "SageMaker (compute status display only)",
                "service"   : "sagemaker",
                "action"    : "list_domains",
                "params"    : {"MaxResults": 1},
                "status"    : False,
                "reqd"      : False
            },
            "sns": {
                "name"      : "SNS (alerts need Publish - write, unprobeable)",
                "service"   : "sns",
                "action"    : "get_topic_attributes",
                "params"    : {"TopicArn": ADMIN_ALERTS_TOPIC_ARN},
                "status"    : False,
                "reqd"      : False
            }
        }

    def _is_optional(self, reqd):
        if not reqd:
            return "O"
        else:
            return "M"

    def _check(self, service: dict[str, Any]):
        is_opt = self._is_optional(service["reqd"])
        try:
            params: Any = service["params"]
            if callable(params):
                params = params()

            if params:
                getattr(aws(service["service"]), service["action"])(**params)
            else:
                getattr(aws(service["service"]), service["action"])()

            service["status"] = True
            print(f"{SUCCESS} [{is_opt}] Connected to {service['name']}")
        except ClientError as e:
            print(f"{FAIL} [{is_opt}] Not Connected to {service['name']}: {str(e)}")
            service["status"] = False
        except Exception as e:
            print(f"{ERROR} [{is_opt}] Error testing {service['name']}: {str(e)}")
            service["status"] = None

    def test(self):
        print("Testing Connectivity to AWS Service Clients")
        print("*" * 43)
        print("Key: [M]-Mandatory, [O]-Optional")
        print("*" * 43)

        print(f"{INFO} Version Python {sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")
        print(f"{INFO} Version Boto3 {boto3.__version__}")
        print(f"{INFO} Identity mode {IDENTITY_MODE or '(unset)'} "
              f"-> domain AuthMode {DOMAIN_AUTH_MODE or '(unset)'}, "
              f"roster in {'Identity Center' if IS_ORG_MODE else 'Cognito'}")

        if MISSING_ENV:
            print(f"{ERROR} Unset environment variables: {', '.join(MISSING_ENV)}")

        passed  = 0
        failed  = 0
        counter = 0

        for key, val in self.aws_services.items():
            self._check(val)

            if val["status"] == True:
                passed += 1
            elif val["status"] == False:
                if(val['reqd'] == False):
                    passed += 1
                else:
                    failed += 1

            counter += 1

        error = counter - (passed + failed)
        print(
            f"\n\033[92m{passed} Connected\033[0m \n\033[93m{failed} Not Connected\033[0m \n\033[91m{error} Has Errors\033[0m\n"
        )

        if failed > 0:
            return False
        else:
            return True

@cache
def preflight():
    """Once per container. @cache so a warm invocation never re-pings."""
    return AWSBoto3Permissions().test()


""" 3. DIRECTORY : ONE OF THESE TWO IS THE ROSTER, DECIDED BY IDENTITY_MODE

IdentityCenter is ORGANIZATION mode, CognitoDirectory is ACCOUNT mode. Both expose the same
operations, so every caller below says `Directory.<op>` and none of them knows which mode it is
running in - the branch happens once, at the alias at the end of this section. """

class IdentityCenter:

    #1. Resolve a student (or an email) to an IdentityStore UserId
    @staticmethod
    def user_id(value, attr='userName'):
        """None if not provisioned in Identity Center yet (IdP sync lag) - callers retry next tick."""
        try:
            return aws('identitystore').get_user_id(
                IdentityStoreId=store_id(),
                AlternateIdentifier={'UniqueAttribute': {'AttributePath': attr, 'AttributeValue': value}},
            )['UserId']
        except ClientError as e:
            if e.response['Error']['Code'] == 'ResourceNotFoundException':
                return None
            raise

    #2. Create the SSO identity the student's stack will reference
    @staticmethod
    def create_user(student_id, given_name, family_name, email):
        """Must precede CreateStack: UserProfile's SingleSignOnUserValue lookup fails the whole create otherwise."""
        with tolerate('ConflictException'):  # already created by IdP sync or a retry
            aws('identitystore').create_user(
                IdentityStoreId=store_id(),
                UserName=student_id,
                DisplayName=f'{given_name} {family_name}',
                Name={'GivenName': given_name, 'FamilyName': family_name},
                Emails=[{'Value': email, 'Primary': True}],
            )

    #3. AWS's own account flag for the user
    @classmethod
    def status(cls, student_id):
        """AWS's UserStatus (ENABLED/DISABLED), or None if not in IdC. NOT a signed-in signal -
        never label it "verified". None also covers "deleted out of band", which is what
        job_stack_status_sync keys off; both directories report a vanished user the same way.
        """
        user_id = cls.user_id(student_id)
        if user_id is None:
            return None
        return aws('identitystore').describe_user(IdentityStoreId=store_id(), UserId=user_id)['UserStatus']

    #4. Grant Studio SSO
    @classmethod
    def add_to_group(cls, student_id):
        """Adds to the platform's StudentGroup so they can SSO into Studio. False (not an exception) if not in IdC yet."""
        user_id = cls.user_id(student_id)
        if user_id is None:
            return False
        with tolerate('ConflictException'):  # already a member
            aws('identitystore').create_group_membership(
                IdentityStoreId=store_id(), GroupId=ssm_get('student-group-id'), MemberId={'UserId': user_id},
            )
        return True

    #5. Revoke Studio SSO
    @classmethod
    def remove_from_group(cls, student_id):
        """Revokes Studio SSO up front, so access dies before the async teardown finishes."""
        user_id = cls.user_id(student_id)
        if user_id is None:
            return
        group_id  = ssm_get('student-group-id')
        paginator = aws('identitystore').get_paginator('list_group_memberships_for_member')
        for page in paginator.paginate(IdentityStoreId=store_id(), MemberId={'UserId': user_id}):
            for membership in page.get('GroupMemberships', []):
                if membership.get('GroupId') != group_id:
                    continue
                with tolerate('ResourceNotFoundException'):
                    aws('identitystore').delete_group_membership(
                        IdentityStoreId=store_id(), MembershipId=membership['MembershipId']
                    )
                return

    #6. Delete the SSO identity
    @classmethod
    def delete_user(cls, student_id):
        """Only once the stack is fully torn down, so no live UserProfile still references this SSO user."""
        user_id = cls.user_id(student_id)
        if user_id is None:
            return
        with tolerate('ResourceNotFoundException'):
            aws('identitystore').delete_user(IdentityStoreId=store_id(), UserId=user_id)

    #7. Layer 2 authZ
    @classmethod
    def is_admin(cls, event):
        """Cognito's JWT 'sub' is NOT the IdentityStore UserId (SAML), so resolve by email claim first."""
        email = claims(event).get('email')
        if not email:
            return False
        user_id = cls.user_id(email, attr='emails.value')
        if user_id is None:
            return False
        return cls._in_group(user_id, ADMIN_GROUP_ID)

    #8. Layer 2 authZ, student side
    @classmethod
    def is_student(cls, event):
        """Interface parity with CognitoDirectory. Reachable but pointless in ORGANIZATION mode:
        an SSO-mode student opens Studio from their IdC portal tile and never calls the API."""
        email = claims(event).get('email')
        if not email:
            return False
        user_id = cls.user_id(email, attr='emails.value')
        if user_id is None:
            return False
        return cls._in_group(user_id, ssm_get('student-group-id'))

    #9. Every login currently holding notebook access, for the reverse audit
    @staticmethod
    def group_member_emails():
        """None - deliberately not implemented in ORGANIZATION mode, where group membership is
        the institution's directory sync to own. None makes job_directory_audit report 'skipped'
        rather than emit a misleadingly empty result.
        """
        return None

    @staticmethod
    def _in_group(user_id, group_id):
        response = aws('identitystore').is_member_in_groups(
            IdentityStoreId=store_id(), MemberId={'UserId': user_id}, GroupIds=[group_id],
        )
        return any(r.get('MembershipExists') for r in response.get('Results', []))


class CognitoDirectory:
    """ACCOUNT-mode twin of IdentityCenter, same operations against the user pool.

    The pool declares UsernameAttributes: [email], so the EMAIL is the username - student_id is
    not a valid Cognito username, and every operation given only one resolves the email out of
    the student's DynamoDB record first. Hence every delete path removes the directory identity
    BEFORE StudentStore.delete: afterwards the mapping is gone and the user is orphaned.
    """

    #1. Resolve a student to their Cognito username (= their email)
    @staticmethod
    def _email_of(student_id):
        """None if there is no record to read it from - callers treat that as 'nothing to do'."""
        student = StudentStore.get(student_id)
        return (student or {}).get('studentEmail') or None

    #2. Create the login identity the student signs in with
    @staticmethod
    def create_user(student_id, given_name, family_name, email):
        """Cognito emails the invitation and temporary password itself, so this doubles as the
        student's onboarding. No SSO binding to wait for, so unlike the SSO path a failure here
        cannot fail the CreateStack that follows."""
        with tolerate('UsernameExistsException'):  # a retry, or an admin pre-created them
            aws('cognito-idp').admin_create_user(
                UserPoolId              = COGNITO_USER_POOL_ID,
                Username                = email,
                UserAttributes          = [
                    {'Name': 'email',           'Value': email},
                    {'Name': 'email_verified',  'Value': 'true'},
                    {'Name': 'name',            'Value': f'{given_name} {family_name}'},
                ],
                DesiredDeliveryMediums  = ['EMAIL'],
            )

    #3. The directory's own account flag for the user
    @classmethod
    def status(cls, student_id):
        """Cognito's UserStatus (CONFIRMED / FORCE_CHANGE_PASSWORD / ...), or None if absent.
        FORCE_CHANGE_PASSWORD is normal until they first sign in, and like IdC's ENABLED it says
        nothing about whether they ever did - never label it "verified"."""
        email = cls._email_of(student_id)
        if email is None:
            return None
        try:
            return aws('cognito-idp').admin_get_user(
                UserPoolId=COGNITO_USER_POOL_ID, Username=email,
            )['UserStatus']
        except ClientError as e:
            if e.response['Error']['Code'] == 'UserNotFoundException':
                return None
            raise

    #4. Grant notebook access
    @classmethod
    def add_to_group(cls, student_id):
        """Group membership is what GET /me/studio-url checks, so this is the grant that lets
        them open their notebook. False (not an exception) if the user isn't there yet."""
        email = cls._email_of(student_id)
        if email is None:
            return False
        try:
            aws('cognito-idp').admin_add_user_to_group(
                UserPoolId=COGNITO_USER_POOL_ID, Username=email, GroupName=COGNITO_STUDENT_GROUP,
            )
        except ClientError as e:
            if e.response['Error']['Code'] == 'UserNotFoundException':
                return False
            raise
        return True

    #5. Revoke notebook access
    @classmethod
    def remove_from_group(cls, student_id):
        """Revokes access up front, so /me/studio-url starts refusing before the async
        teardown finishes. Already-not-a-member is a success, not an error."""
        email = cls._email_of(student_id)
        if email is None:
            return
        with tolerate('UserNotFoundException', 'ResourceNotFoundException'):
            aws('cognito-idp').admin_remove_user_from_group(
                UserPoolId=COGNITO_USER_POOL_ID, Username=email, GroupName=COGNITO_STUDENT_GROUP,
            )

    #6. Delete the login identity
    @classmethod
    def delete_user(cls, student_id):
        email = cls._email_of(student_id)
        if email is None:
            return
        with tolerate('UserNotFoundException'):
            aws('cognito-idp').admin_delete_user(UserPoolId=COGNITO_USER_POOL_ID, Username=email)

    #7. Layer 2 authZ
    @classmethod
    def is_admin(cls, event):
        return COGNITO_ADMIN_GROUP in cls._groups(event)

    #8. Layer 2 authZ, student side
    @classmethod
    def is_student(cls, event):
        return COGNITO_STUDENT_GROUP in cls._groups(event)

    @staticmethod
    def _groups(event):
        """The cognito:groups claim, as a set of names.

        Two shapes: a JWT authorizer on an HTTP API flattens claims, so a multi-valued one
        arrives as "[a b]" rather than a JSON list, while the local harness passes a real list.
        The AdminListGroupsForUser fallback covers the claim being absent entirely (scopes
        trimmed on the app client) - one extra call instead of a wrong 403.
        """
        raw = claims(event).get('cognito:groups')
        if isinstance(raw, list):
            return {str(g) for g in raw}
        if isinstance(raw, str) and raw.strip():
            return set(raw.strip().strip('[]').replace(',', ' ').split())

        email = claims(event).get('email')
        if not email:
            return set()
        try:
            response = aws('cognito-idp').admin_list_groups_for_user(
                UserPoolId=COGNITO_USER_POOL_ID, Username=email,
            )
        except ClientError as e:
            if e.response['Error']['Code'] == 'UserNotFoundException':
                return set()
            raise
        return {g['GroupName'] for g in response.get('Groups', [])}

    #9. Every login currently holding notebook access, for the reverse audit
    @staticmethod
    def group_member_emails():
        """Lowercased emails of everyone in the student group - the other half of the sweep.
        _sync_stack_one catches a record whose login vanished; this catches a login that never
        had a record, which federation makes likely: a SAML user appears in the pool on first
        sign-in without passing through api_add_student.
        """
        emails      = set()
        paginator   = aws('cognito-idp').get_paginator('list_users_in_group')
        for page in paginator.paginate(UserPoolId=COGNITO_USER_POOL_ID, GroupName=COGNITO_STUDENT_GROUP):
            for user in page.get('Users', []):
                for attribute in user.get('Attributes', []):
                    if attribute['Name'] == 'email':
                        emails.add(attribute['Value'].strip().lower())
        return emails


# The one branch. Every caller below says Directory.<op> and stays mode-agnostic;
# swapping the roster is this line, not a search-and-replace through the file.
Directory = IdentityCenter if IS_ORG_MODE else CognitoDirectory


""" 4. DYNAMODB """

def _scan_all(name):
    items, kwargs = [], {}
    while True:
        response = table(name).scan(**kwargs)
        items.extend(response.get('Items', []))
        if 'LastEvaluatedKey' not in response:
            return items
        kwargs['ExclusiveStartKey'] = response['LastEvaluatedKey']

class StudentStore:

    TABLE = STUDENTS_TABLE

    @classmethod
    def scan(cls):
        return _scan_all(cls.TABLE)

    @classmethod
    def get(cls, student_id):
        return table(cls.TABLE).get_item(Key={'studentId': student_id}).get('Item')

    @classmethod
    def claim(cls, item):
        """Write the record only if nothing owns this studentId yet. True if we now own it.

        The atomic half of api_add_student's uniqueness check, and the ONLY way to create a
        record: there is deliberately no unconditional put(), so no caller can reintroduce the
        race by accident. A get()-then-put() passes a double-submitted form twice - measured on
        2026-08-25, where the loser's rollback deleted the record and the Cognito login the
        winner had just created, leaving a provisioned stack nobody could sign in to.
        """
        try:
            table(cls.TABLE).put_item(
                Item                = item,
                ConditionExpression = 'attribute_not_exists(studentId)',
            )
        except ClientError as e:
            if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
                return False
            raise
        return True

    @classmethod
    def delete(cls, student_id):
        table(cls.TABLE).delete_item(Key={'studentId': student_id})

    @classmethod
    def update(cls, student_id, updates):
        if not updates:
            return
        fields = list(updates.items())
        table(cls.TABLE).update_item(
            Key                         = {'studentId': student_id},
            UpdateExpression            = 'SET ' + ', '.join(f'#f{i} = :v{i}' for i in range(len(fields))),
            ExpressionAttributeNames    = {f'#f{i}': k for i, (k, _) in enumerate(fields)},
            ExpressionAttributeValues   = {f':v{i}': v for i, (_, v) in enumerate(fields)},
        )

class AlarmEventStore:

    TABLE = ALARM_EVENTS_TABLE

    @classmethod
    def scan(cls):
        return sorted(_scan_all(cls.TABLE), key=lambda e: e.get('alarmTimestamp', ''), reverse=True)

    @classmethod
    def record(cls, student_id, alarm_type, spend_at_alarm, budget_usd, action, status):
        table(cls.TABLE).put_item(Item={
            'eventId'           : str(uuid.uuid4()),
            'studentId'         : student_id,
            'alarmTimestamp'    : now_iso(),
            'alarmType'         : alarm_type,
            'spendAtAlarmUsd'   : spend_at_alarm,
            'budgetUsd'         : Decimal(str(budget_usd)),
            'enforcementAction' : action,
            'status'            : status,
        })

class UsageLedger:
    """The consumption ledger. PK studentId, SK sk - two row kinds in one table:

        SESSION#<domainId>|<appType>|<owner>|<appName>   one row per Studio app ever seen,
            holding the accrual state the meter resumes from. TTL'd: working state, not records.
        PERIOD#<YYYY-MM>                                 one row per student per month.
            accruedUsd on this row IS the number the cap is compared against.

    One table rather than two because every read the meter does is "everything I know about this
    student" - a single Query on the partition key.
    """

    TABLE = USAGE_LEDGER_TABLE

    @staticmethod
    def session_key(domain_id, app_type, owner, app_name):
        """Stable identity for one Studio app, and the reason a restart is not double-billed.
        Studio reuses app names, so name alone collides across students. Owner is the Space name
        when the app lives in a Space and the user profile name otherwise - see DomainSnapshot.
        """
        return f'SESSION#{domain_id}|{app_type}|{owner}|{app_name}'

    @classmethod
    def rows(cls, student_id):
        return table(cls.TABLE).query(
            KeyConditionExpression = Key('studentId').eq(student_id)).get('Items', [])

    @classmethod
    def sessions(cls, student_id):
        return [r for r in cls.rows(student_id) if str(r.get('sk', '')).startswith('SESSION#')]

    @classmethod
    def period(cls, student_id, period=None):
        item = table(cls.TABLE).get_item(
            Key={'studentId': student_id, 'sk': f'PERIOD#{period or period_of()}'}).get('Item')
        return item or {}

    @classmethod
    def period_spend(cls, student_id, period=None):
        return float(cls.period(student_id, period).get('accruedUsd') or 0)

    @classmethod
    def put_session(cls, student_id, sk, fields):
        table(cls.TABLE).put_item(Item={'studentId': student_id, 'sk': sk, **fields})

    @classmethod
    def add_to_period(cls, student_id, seconds, amount_usd, instance_type, period=None):
        """Atomic accumulate, returning the new period total so the caller can judge the cap
        without a re-read. ADD rather than read-modify-write because the sweep can overlap
        itself, and a dropped increment is an under-enforced cap.

        byInstanceType uses SET x = if_not_exists(x, 0) + v instead, because ADD only reaches
        top-level attributes and rejects a nested path. Evaluated server-side, so equally safe.
        """
        period = period or period_of()
        response = table(cls.TABLE).update_item(
            Key                 = {'studentId': student_id, 'sk': f'PERIOD#{period}'},
            UpdateExpression    = ('ADD accruedSeconds :s, accruedUsd :u '
                                   'SET updatedAt = :now, period = :p, '
                                   'byInstanceType.#it = if_not_exists(byInstanceType.#it, :zero) + :u'),
            ExpressionAttributeNames  = {'#it': instance_type},
            ExpressionAttributeValues = {':s'   : Decimal(str(int(seconds))),
                                         ':u'   : usd(amount_usd),
                                         ':zero': Decimal(0),
                                         ':now' : now_iso(),
                                         ':p'   : period},
            ReturnValues        = 'ALL_NEW',
        )
        return float(response['Attributes'].get('accruedUsd') or 0)

    @classmethod
    def ensure_period(cls, student_id, period=None):
        """byInstanceType must exist as a map before a key inside it can be addressed, and
        DynamoDB will not create the intermediate path. attribute_not_exists keeps this a no-op
        after the first sample of the month rather than clobbering the running total."""
        with tolerate('ConditionalCheckFailedException'):
            table(cls.TABLE).update_item(
                Key                 = {'studentId': student_id, 'sk': f'PERIOD#{period or period_of()}'},
                UpdateExpression    = 'SET byInstanceType = :empty, createdAt = :now',
                ConditionExpression = 'attribute_not_exists(byInstanceType)',
                ExpressionAttributeValues = {':empty': {}, ':now': now_iso()},
            )

    @classmethod
    def purge(cls, student_id):
        """Called on student deletion. The ledger is per-student data, so it goes with them."""
        rows = cls.rows(student_id)
        if not rows:
            return 0
        with table(cls.TABLE).batch_writer() as batch:
            for row in rows:
                batch.delete_item(Key={'studentId': student_id, 'sk': row['sk']})
        return len(rows)


""" 5. CLOUDFORMATION """

class StackService:

    @staticmethod
    def create(stack_name, student_id, instance_type, per_student_budget_usd,
               notification_email, existing_domain_id, template_url,
               storage_kms_key_arn):
        """Every parameter here must exist in whatever template template-s3-url points at, or
        CloudFormation rejects the whole call before creating anything.

        DomainAuthMode must match the domain: the UserProfile may carry SingleSignOnUser* only
        under SSO, and must not under IAM. It comes from the platform stack's own
        DOMAIN_AUTH_MODE rather than being inferred here, so the two cannot drift.

        StorageKmsKeyArn lets the student's execution role use the CMK the domain encrypts Space
        volumes with. Omit it and the stack still reaches CREATE_COMPLETE - the failure surfaces
        only when the student opens their first notebook. Because that gap is invisible at deploy
        time, this argument has no default.
        """
        aws('cloudformation').create_stack(
            StackName       = stack_name,
            TemplateURL     = template_url,
            Parameters      = [{'ParameterKey': k, 'ParameterValue': str(v)} for k, v in {
                'ExistingDomainId'      : existing_domain_id,
                'DomainAuthMode'        : DOMAIN_AUTH_MODE,
                'StudentId'             : student_id,
                'InstanceType'          : instance_type,
                'PerStudentBudgetUsd'   : per_student_budget_usd,
                'NotificationEmail'     : notification_email,
                'StorageKmsKeyArn'      : storage_kms_key_arn,
            }.items()],
            Capabilities    = ['CAPABILITY_NAMED_IAM'],
            RoleARN         = STUDENT_STACK_DEPLOY_ROLE_ARN,
            Tags            = [{'Key': 'ManagedBy', 'Value': MANAGED_BY_TAG}],
        )

    @staticmethod
    def delete(stack_name):
        aws('cloudformation').delete_stack(StackName=stack_name, RoleARN=STUDENT_STACK_DEPLOY_ROLE_ARN)

    @staticmethod
    def describe(stack_name):
        """None if the stack doesn't exist, rather than raising."""
        try:
            return aws('cloudformation').describe_stacks(StackName=stack_name)['Stacks'][0]
        except ClientError as e:
            if 'does not exist' in str(e):
                return None
            raise


""" 6. METERING, ENFORCEMENT, SAGEMAKER & SNS """

class Rates:

    @staticmethod
    def hourly(instance_type):
        """$/hour for a Studio JupyterLab app, and NEVER 0 for a type we don't recognise - that
        would be a hole straight through the cap. Returns (rate, is_known) so the caller can log
        the fallback loudly.
        """
        rate = NOTEBOOK_HOURLY_USD.get(instance_type)
        if rate is None:
            return UNKNOWN_INSTANCE_HOURLY_USD, False
        return rate, True

class ConsumptionLog:
    """Append-only audit trail in CloudWatch Logs, one JSON line per metered sample.

    Why both this and DynamoDB: the ledger is mutable running state, so it can say what a student
    owes but not how that number was reached. A disputed suspension has to be answerable from
    something nothing overwrites, and Logs Insights over these lines reconstructs the accrual.

    NEVER RAISES. A logging failure must not stop the sweep that enforces the cap, so a failed
    PutLogEvents degrades to print() - still durable, just not queryable alongside the rest.
    """

    _stream = None

    @classmethod
    def _stream_name(cls):
        """One stream per container per day. Per-invocation streams would mean a CreateLogStream
        call every tick for no benefit; one shared stream would serialise sequence tokens."""
        if cls._stream is None:
            cls._stream = f'{day_of()}/{uuid.uuid4().hex[:12]}'
            with tolerate('ResourceAlreadyExistsException'):
                aws('logs').create_log_stream(
                    logGroupName=CONSUMPTION_LOG_GROUP, logStreamName=cls._stream)
        return cls._stream

    @classmethod
    def write(cls, records):
        if not records:
            return
        try:
            now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
            aws('logs').put_log_events(
                logGroupName    = CONSUMPTION_LOG_GROUP,
                logStreamName   = cls._stream_name(),
                logEvents       = [{'timestamp': now_ms,
                                    'message'  : json.dumps(r, cls=DecimalEncoder)}
                                   for r in records],
            )
        except Exception as e:                                   # noqa: BLE001 - see class docstring
            print(f'{FAIL} consumption log unavailable ({e}) - falling back to stdout')
            for record in records:
                print(f'CONSUMPTION {json.dumps(record, cls=DecimalEncoder)}')

class DomainSnapshot:
    """One domain-wide view of Studio, built once per sweep and indexed by owner.

    The alternative is listing the whole domain once per student: O(students x domain) calls per
    tick, which at thirty students on a five-minute schedule was 8,640 ListApps pages a day to
    answer a question one page could answer.

    Apps are keyed by OWNER, which is the Space name when the app runs in a Space and the user
    profile name otherwise. Both cases are real: opening JupyterLab auto-creates a private Space,
    and the app inside it reports UserProfileName as null.
    """

    def __init__(self, domain_id):
        self.domain_id      = domain_id
        self.space_owner    = {}    # space name -> owning user profile name
        self.apps_by_owner  = {}    # user profile name -> [app, ...]
        if not domain_id:
            return
        for page in aws('sagemaker').get_paginator('list_spaces').paginate(DomainIdEquals=domain_id):
            for space in page.get('Spaces', []):
                owner = (space.get('OwnershipSettingsSummary') or {}).get('OwnerUserProfileName')
                if owner:
                    self.space_owner[space['SpaceName']] = owner
        for page in aws('sagemaker').get_paginator('list_apps').paginate(DomainIdEquals=domain_id):
            for app in page.get('Apps', []):
                owner = app.get('UserProfileName') or self.space_owner.get(app.get('SpaceName'))
                if owner:
                    self.apps_by_owner.setdefault(owner, []).append(app)

    def apps(self, user_profile_name):
        return self.apps_by_owner.get(user_profile_name, []) if user_profile_name else []

    def running(self, user_profile_name):
        return [a for a in self.apps(user_profile_name) if a.get('Status') in RUNNING_STATUSES]

    def compute_status(self, user_profile_name):
        if not self.domain_id or not user_profile_name:
            return None
        return 'RUNNING' if self.running(user_profile_name) else 'STOPPED'

class Meter:
    """Turns "which apps are running right now" into "what this student has spent this month".

    Each tick bills every running app for the wall-clock time since it was last billed, assuming
    nothing about the schedule: a sweep that skipped an hour bills the hour. What it cannot
    catch is an app that starts and stops entirely between two ticks - docs/COSTING.md §4.2
    quantifies that window. Charging from CreationTime on first sight is what makes a cold start
    safe: a notebook up for two hours before this system saw it is billed for two hours.
    """

    @staticmethod
    def sample(student, snapshot):
        """Meter one student against a snapshot. Returns (period_spend_usd, session_views).
        Writes each increment as it goes rather than batching, so a mid-sweep failure loses at
        most one app's sample instead of the student's whole tick.
        """
        student_id      = student['studentId']
        profile         = student.get('userProfileName')
        now             = datetime.now(timezone.utc)
        period          = period_of(now)
        records, views  = [], []

        UsageLedger.ensure_period(student_id, period)
        known    = {r['sk']: r for r in UsageLedger.sessions(student_id)}
        total    = UsageLedger.period_spend(student_id, period)
        seen     = set()

        for app in snapshot.running(profile):
            app_type    = app.get('AppType', 'JupyterLab')
            owner       = app.get('SpaceName') or app.get('UserProfileName') or profile
            sk          = UsageLedger.session_key(snapshot.domain_id, app_type, owner, app['AppName'])
            instance    = ((app.get('ResourceSpec') or {}).get('InstanceType')
                           or student.get('instanceType') or DEFAULT_INSTANCE_TYPE)
            seen.add(sk)
            rate, known_rate = Rates.hourly(instance)
            if not known_rate:
                print(f'{FAIL} {student_id}: unknown instance type {instance!r}, '
                      f'billing at the highest known rate ${rate:.4f}/h - add it to NOTEBOOK_HOURLY_USD')

            created     = parse_iso(app.get('CreationTime')) or now
            row         = known.get(sk) or {}
            # First sight of this app bills from when Studio says it started, not from now.
            since       = parse_iso(row.get('lastSampledAt')) or created
            seconds     = max(0, int((now - since).total_seconds()))
            if seconds == 0 and row:
                continue                                    # same tick twice, nothing to bill

            amount      = seconds / 3600 * rate
            accrued_s   = int(row.get('accruedSeconds') or 0) + seconds
            accrued_usd = float(row.get('accruedUsd') or 0) + amount

            UsageLedger.put_session(student_id, sk, {
                'appName'           : app['AppName'],
                'appType'           : app_type,
                'spaceName'         : app.get('SpaceName') or '',
                'userProfileName'   : profile or '',
                'instanceType'      : instance,
                'hourlyRateUsd'     : usd(rate),
                'ratesAsOf'         : RATES_ASOF,
                'startedAt'         : created.isoformat(),
                'lastSampledAt'     : now.isoformat(),
                'accruedSeconds'    : accrued_s,
                'accruedUsd'        : usd(accrued_usd),
                'status'            : SESSION_ACTIVE,
                'expiresAt'         : int((now + timedelta(days=LEDGER_TTL_DAYS)).timestamp()),
            })
            total = UsageLedger.add_to_period(student_id, seconds, amount, instance, period)

            records.append({'event'        : 'sample',
                            'studentId'    : student_id,
                            'period'       : period,
                            'appName'      : app['AppName'],
                            'spaceName'    : app.get('SpaceName') or '',
                            'instanceType' : instance,
                            'hourlyRateUsd': round(rate, 4),
                            'ratesAsOf'    : RATES_ASOF,
                            'windowFrom'   : since.isoformat(),
                            'windowTo'     : now.isoformat(),
                            'billedSeconds': seconds,
                            'billedUsd'    : round(amount, 4),
                            'periodUsd'    : round(total, 4),
                            'rateKnown'    : known_rate})
            views.append({'appName'        : app['AppName'],
                          'instanceType'   : instance,
                          'hourlyRateUsd'  : round(rate, 4),
                          'startedAt'      : created.isoformat(),
                          'accruedUsd'     : round(accrued_usd, 4),
                          'accruedSeconds' : accrued_s})

        # Marking a vanished app closed is what stops the next tick billing from its stale
        # lastSampledAt if Studio hands the same app name back. The row is kept, not deleted:
        # it is the accrual evidence.
        for sk, row in known.items():
            if row.get('status') == SESSION_ACTIVE and sk not in seen:
                UsageLedger.put_session(student_id, sk, {**row,
                                                        'status'  : SESSION_CLOSED,
                                                        'closedAt': now.isoformat()})
                records.append({'event': 'session_closed', 'studentId': student_id,
                                'appName': row.get('appName'), 'period': period,
                                'accruedUsd': float(row.get('accruedUsd') or 0)})

        ConsumptionLog.write(records)
        return total, views

def percent_of(spend, budget_usd):
    """Whole percent, rounded down, and 0 rather than a ZeroDivisionError on a zero cap."""
    budget = float(budget_usd or 0)
    return int(spend / budget * 100) if budget > 0 else 0

def _record_percent(student_id, spend, budget_usd):
    """Mirror the ledger's period total onto the student record. Denormalised on purpose: the
    console lists thirty students at a time and would otherwise need thirty ledger reads to draw
    a progress bar. The ledger stays authoritative - this copy is display state, and every writer
    recomputes from the ledger rather than incrementing what is here.
    """
    StudentStore.update(student_id, {
        'currentSpendUsd'   : usd(spend),
        'percentUsed'       : percent_of(spend, budget_usd),
        'usagePeriod'       : period_of(),
        'usageUpdatedAt'    : now_iso(),
    })

class Enforcement:

    @staticmethod
    def suspend(execution_role_arn, deny_policy_arn, stop_function_arn):
        """Manual twin of the template's native breach enforcement: block new sessions, then kill the running one."""
        aws('iam').attach_role_policy(RoleName=execution_role_arn.rsplit('/', 1)[-1], PolicyArn=deny_policy_arn)
        aws('lambda').invoke(FunctionName=stop_function_arn, InvocationType='Event')

    @staticmethod
    def resume(execution_role_arn, deny_policy_arn):
        aws('iam').detach_role_policy(RoleName=execution_role_arn.rsplit('/', 1)[-1], PolicyArn=deny_policy_arn)

    @staticmethod
    def compute_status(domain_id, user_profile_name, snapshot=None):
        """Whether Studio is actually running - the thing enforcement affects. None if not
        provisioned far enough.

        Matches on Space OR UserProfile rather than asking for one profile's apps, because an app
        inside a Space reports UserProfileName as null and list_apps(UserProfileNameEquals=...)
        does not return it at all. That filter is what this used to do, and it reported STOPPED
        over a JupyterLab that had been InService for three days - so the console showed no
        compute and the breach-time stop function had nothing to stop either.

        Pass `snapshot` from any caller in a loop, or this builds a whole domain view per student.
        """
        if not domain_id or not user_profile_name:
            return None
        return (snapshot or DomainSnapshot(domain_id)).compute_status(user_profile_name)

class Alerts:

    @staticmethod
    def admin(subject, message):
        """One consolidated channel ops watches, confirmed once ever regardless of student count."""
        aws('sns').publish(TopicArn=ADMIN_ALERTS_TOPIC_ARN, Subject=subject[:100], Message=message)


""" 7. API HANDLERS """

def student_route(*, require_provisioned=False):
    """Resolves {studentId} -> the item, 404 if unknown, 409 if not provisioned, so handlers start at the point."""
    def decorator(fn):
        @wraps(fn)
        def wrapper(event):
            student_id  = event['pathParameters']['studentId']
            student     = StudentStore.get(student_id)
            if student is None:
                return reply(404, {'error': f'Student {student_id} not found'})
            if require_provisioned and not student.get('executionRoleArn'):
                return reply(409, {'error': 'Student stack is not fully provisioned yet'})
            return fn(event, student_id, student)
        return wrapper
    return decorator

#1. Bootstrap config for the console
def api_platform_info(event):
    """Read-only bootstrap config from the platform stack's own Outputs via SSM - never written back."""
    return reply(200, {
        'studioDomainId'            : ssm_get('existing-domain-id'),
        # null in ACCOUNT mode: the template writes these three only under ORGANIZATION, so a
        # hard read would 500 the SPA's first request in an otherwise healthy deploy. The mode
        # is answered by identityMode below, not by guessing from these being empty.
        'studentGroupId'            : ssm_get_optional('student-group-id'),
        'identityStoreId'           : ssm_get_optional('identity-store-id'),
        'identityCenterInstanceArn' : ssm_get_optional('identity-center-instance-arn'),
        'templateS3Url'             : ssm_get('template-s3-url'),
        # From the environment, not SSM: these describe the shape the stack was deployed in,
        # which is what the SPA needs to pick an IdC portal link or an "Open my notebook" button.
        'identityMode'              : IDENTITY_MODE,
        'domainAuthMode'            : DOMAIN_AUTH_MODE,
        'rosterDirectory'           : 'IDENTITY_CENTER' if IS_ORG_MODE else 'COGNITO',
        'cognitoUserPoolId'         : COGNITO_USER_POOL_ID,
        'cognitoAdminGroup'         : COGNITO_ADMIN_GROUP,
        'cognitoStudentGroup'       : COGNITO_STUDENT_GROUP,
    })

#1b. Branding, before anyone has logged in - the only unauthenticated route
def api_init(event):
    """What the SPA needs to render its shell and its sign-in button on a cold load.

    Unauthenticated by design, so what it may contain is the whole question. Cosmetic values and
    public sign-in coordinates only - no Studio domain id, no template URL, no ARN, no roster, no
    counts. THE RULE FOR ADDING A FIELD: if it would interest someone who cannot log in, it does
    not belong here.
    """
    return {
        'statusCode' : 200,
        'headers'    : {'Content-Type' : 'application/json',
                        # Branding changes at deploy time, roughly never. Five minutes keeps this
                        # off every page load without making a rebrand need an invalidation.
                        'Cache-Control': 'public, max-age=300'},
        'body'       : json.dumps({
            'appTitle'          : APP_TITLE or 'AWS SageMaker GPU Guardian',
            'appShortName'      : APP_SHORT_NAME or 'GPU Guardian',
            'logoUrl'           : APP_LOGO_URL or DEFAULT_LOGO_URL,
            'faviconUrl'        : APP_FAVICON_URL or DEFAULT_FAVICON_URL,
            'primaryColor'      : APP_PRIMARY_COLOR or DEFAULT_PRIMARY_COLOR,
            'institutionName'   : APP_INSTITUTION_NAME or 'Amazon Web Services',
            'supportEmail'      : APP_SUPPORT_EMAIL,
            # Which sign-in flow to draw. The SPA cannot infer this, and hardcoding it is how
            # the two deploy modes drift.
            'identityMode'      : IDENTITY_MODE,
            'auth'              : {
                'userPoolId'    : COGNITO_USER_POOL_ID,
                'clientId'      : COGNITO_CLIENT_ID,
                'hostedUiDomain': COGNITO_HOSTED_UI_DOMAIN,
                'redirectUri'   : FRONTEND_URL,
                'adminGroup'    : COGNITO_ADMIN_GROUP,
                'studentGroup'  : COGNITO_STUDENT_GROUP,
            },
        }),
    }

#1c. Which screen to send the caller to
def api_whoami(event):
    """Authenticated, but open to both audiences - the routing primitive the SPA needs.

    Without it, "which page do I belong on" is only answerable by calling an admin route and
    reading the 403, which logs an apparent attack on every student's first page load. This
    asserts nothing the token does not already say.
    """
    is_admin    = Directory.is_admin(event)
    is_student  = Directory.is_student(event)
    return reply(200, {
        'email'         : claims(event).get('email'),
        'isAdmin'       : is_admin,
        'isStudent'     : is_student,
        # Admin wins when someone is in both groups - a teaching assistant with a notebook of
        # their own lands on the console and can still reach /me.
        'landing'       : 'ADMIN' if is_admin else 'STUDENT' if is_student else 'NONE',
    })

#2. Listings
def api_list_students(event):
    return reply(200, {'students': StudentStore.scan()})

def api_list_alarm_events(event):
    return reply(200, {'events': AlarmEventStore.scan()})

@student_route()
def api_get_student(event, student_id, student):
    return reply(200, student)

#3. Provision a student
def api_add_student(event):
    """Claim the id, create the login, create the stack - strictly in that order.

    THE ORDER IS THE SAFETY PROPERTY, not a style choice. The record is claimed FIRST, with a
    conditional write, so exactly one concurrent request proceeds past it and everything after
    is unambiguously owned by this caller - which is what makes the rollback below safe to run.
    See StudentStore.claim for what a get()-then-put() cost.
    """
    body        = json.loads(event.get('body') or '{}')
    student_id  = (body.get('studentId') or '').strip()
    if not student_id:
        return reply(400, {'error': 'studentId is required'})

    # Every field validated before anything is written, so a 400 never leaves a claimed id
    # behind for the operator to clear.
    given_name      = (body.get('givenName') or '').strip()
    family_name     = (body.get('familyName') or '').strip()
    student_email   = (body.get('studentEmail') or '').strip()
    if not (given_name and family_name and student_email):
        return reply(400, {'error': 'givenName, familyName, and studentEmail are required to create '
                                    'their login identity'})

    instance_type       = body.get('instanceType') or DEFAULT_INSTANCE_TYPE
    budget_usd          = Decimal(str(body.get('perStudentBudgetUsd', DEFAULT_BUDGET_USD)))
    notification_email  = body.get('notificationEmail') or ssm_get('notification-email-default')
    stack_name          = f'{STACK_NAME_PREFIX}{student_id}'
    now                 = now_iso()

    # The uniqueness check IS this write - there is no separate get() any more, because two of
    # them can both answer "free" for the same id.
    record = {
        'studentId'             : student_id,
        'stackName'             : stack_name,
        'status'                : 'PROVISIONING',
        'provisioningStatus'    : 'CREATE_IN_PROGRESS',
        'givenName'             : given_name,
        'familyName'            : family_name,
        'studentEmail'          : student_email,
        'instanceType'          : instance_type,
        'perStudentBudgetUsd'   : budget_usd,
        'notificationEmail'     : notification_email,
        'breachSubscribed'      : False,
        'manualOverride'        : 'NONE',
        'spendHistory'          : [],
        # Seeded rather than left absent so both pages render $0.00 of $80 immediately, rather
        # than an empty cell until the first sweep lands.
        'currentSpendUsd'       : Decimal(0),
        'percentUsed'           : 0,
        'usagePeriod'           : period_of(),
        'createdAt'             : now,
        'createdBy'             : caller_identity(event),
        'updatedAt'             : now,
    }

    claimed = StudentStore.claim(record)
    if not claimed:
        # Something owns this id. Two very different things land here and they need different
        # answers, so ask which one before refusing.
        existing = StudentStore.get(student_id) or {}

        # (a) A finished teardown whose record has not been reaped yet. api_delete_student is
        # asynchronous, so the record survives up to a full tick after the stack is gone, and
        # re-adding the same id inside that window used to 409 - measured on 2026-08-26 as a
        # 2m23s window in which every re-add failed and the id looked permanently burned.
        #
        # So reap here rather than waiting for the tick. This is the DELETING branch of
        # _sync_stack_one, reachable only once the stack is genuinely gone, so it cannot race a
        # live teardown or a concurrent create - those fall through to (b) and (c). Directory
        # calls precede StudentStore.delete for the usual reason: in ACCOUNT mode Directory
        # resolves the Cognito username out of that very record.
        if (existing.get('status') == 'DELETING' and existing.get('stackName')
                and StackService.describe(existing['stackName']) is None):
            print(f'api_add_student: reaping the finished teardown of {student_id} so this add can proceed')
            try:
                Directory.remove_from_group(student_id)
                Directory.delete_user(student_id)
            except Exception as e:
                # A directory identity that outlived its stack must not block the re-add; the
                # create below will fail loudly on its own if the username is genuinely taken.
                print(f'api_add_student: reaping {student_id} left its directory identity behind: {e}')
            StudentStore.delete(student_id)
            # Still conditional, so a second request that reaped the same record concurrently
            # loses here instead of overwriting this one.
            claimed = StudentStore.claim(record)
            reaped  = True
        else:
            reaped  = False

        # (b) The teardown is still running. Say so, and say it is worth retrying - the generic
        # "already exists" invited the operator to change the id instead of waiting.
        if not claimed and not reaped and existing.get('status') == 'DELETING':
            return reply(409, {'error': f'Student {student_id} is still being deleted. Wait for that to '
                                        f'finish, then add them again.'})

        # (c) The double-submit loser lands here, having touched nothing at all - no directory
        # identity, no stack, and above all not the winner's record.
        if not claimed:
            return reply(409, {'error': f'Student {student_id} already exists'})

    try:
        Directory.create_user(student_id, given_name, family_name, student_email)
    except Exception as e:
        # Release the claim, or a transient directory failure burns the id permanently: the
        # record would sit at PROVISIONING with no stack and no login, and every retry would 409.
        StudentStore.delete(student_id)
        return reply(502, {'error': f'Failed to create login identity: {e}'})

    try:
        StackService.create(
            stack_name              = stack_name,
            student_id              = student_id,
            instance_type           = instance_type,
            per_student_budget_usd  = budget_usd,
            notification_email      = notification_email,
            existing_domain_id      = ssm_get('existing-domain-id'),
            template_url            = ssm_get('template-s3-url'),
            # Optional only so a platform stack predating the CMK still provisions students.
            # On every stack this deploys today it is present, and notebooks need it.
            storage_kms_key_arn     = ssm_get_optional('storage-kms-key-arn') or '',
        )
    except Exception as e:
        # CreateStack can fail synchronously before any stack exists - don't leave a ghost
        # PROVISIONING record. Safe to undo unconditionally: holding the claim means everything
        # below is this request's own work. Directory first, then the record, because
        # CognitoDirectory resolves the username out of that very record.
        try:
            Directory.delete_user(student_id)
        except Exception as cleanup_error:
            print(f'api_add_student: rolled back {student_id} but its directory identity survives: {cleanup_error}')
        StudentStore.delete(student_id)
        # A taken stack name can no longer mean "another request beat us" - the claim settles
        # that. It means a stack outlived its student record, which needs a human, not a retry.
        if isinstance(e, ClientError) and e.response['Error']['Code'] == 'AlreadyExistsException':
            print(f'{FAIL} api_add_student: stack {stack_name} exists with no student record owning it')
            return reply(409, {'error': f'A CloudFormation stack named {stack_name} already exists, but no '
                                        f'student record owns it - it was left behind by an earlier '
                                        f'attempt. Delete that stack, then add {student_id} again.'})
        return reply(502, {'error': f'Failed to create stack: {e}'})

    return reply(202, {'studentId': student_id, 'status': 'PROVISIONING'})

#4. Deprovision
@student_route()
def api_delete_student(event, student_id, student):
    try:
        Directory.remove_from_group(student_id)
    except Exception as e:
        # Non-fatal: the sync job retries this (idempotent) before deleting the user, so directory blips never block.
        print(f'api_delete_student: failed to remove {student_id} from group: {e}')
    try:
        purged = UsageLedger.purge(student_id)
        print(f'api_delete_student: purged {purged} ledger rows for {student_id}')
    except Exception as e:
        # Non-fatal, and deliberately not retried: the consumption log keeps the audit trail
        # regardless, so orphaned ledger rows are clutter rather than a correctness problem.
        print(f'api_delete_student: failed to purge the ledger for {student_id}: {e}')
    StackService.delete(student['stackName'])
    StudentStore.update(student_id, {
        'status'                : 'DELETING',
        'provisioningStatus'    : 'DELETE_IN_PROGRESS',
        'updatedAt'             : now_iso(),
    })
    return reply(202, {'studentId': student_id, 'status': 'DELETING'})

#5. Budget
@student_route()
def api_update_budget(event, student_id, student):
    """The cap lives in this record and NOWHERE else - there is no second copy to drift from it,
    and the stack's PerStudentBudgetUsd parameter is a provisioning-time reference value only.
    """
    body = json.loads(event.get('body') or '{}')
    try:
        new_budget = float(body.get('perStudentBudgetUsd'))
    except (TypeError, ValueError):
        new_budget = -1
    if new_budget <= 0:
        return reply(400, {'error': 'perStudentBudgetUsd must be a positive number'})

    now     = now_iso()
    updates = {
        'perStudentBudgetUsd'   : Decimal(str(new_budget)),
        'updatedBudgetBy'       : caller_identity(event),
        'updatedAt'             : now,
    }
    # Console record only - never calls UpdateSubscriber, so the template's original EMAIL subscriber is untouched.
    if body.get('notificationEmail'):
        updates['notificationEmail'] = body['notificationEmail'].strip()

    # Raising the cap above what a budget-held student has spent is, in practice, an instruction
    # to let them carry on - so lift it here rather than making ops remember to press Resume.
    # Manual and directory holds are left alone: neither is about the number being changed.
    spend       = UsageLedger.period_spend(student_id)
    resumed     = False
    if (student.get('status') == 'ON_HOLD'
            and student.get('onHoldKind', HOLD_BUDGET) == HOLD_BUDGET
            and spend < new_budget
            and student.get('executionRoleArn')):
        try:
            Enforcement.resume(student['executionRoleArn'], student['denyPolicyArn'])
            updates.update({'status'        : 'ACTIVE',
                            'onHoldKind'    : '',
                            'onHoldReason'  : (f'Hold lifted at {now}: cap raised to ${new_budget:.2f} '
                                              f'by {caller_identity(event)}, ${spend:.2f} spent.')})
            resumed = True
        except Exception as e:
            # The new cap is still worth recording even if the detach failed - the next sweep
            # will see spend under cap and try again.
            print(f'{FAIL} api_update_budget: raised the cap for {student_id} but could not lift the hold: {e}')

    StudentStore.update(student_id, updates)
    _record_percent(student_id, spend, new_budget)
    return reply(200, {'studentId'           : student_id,
                       'perStudentBudgetUsd' : new_budget,
                       'currentSpendUsd'     : round(spend, 2),
                       'resumed'             : resumed})

#6. Resolving the caller to their own record - shared by both /me routes
def _caller_student(event):
    """(student, None) on success, (None, error_response) otherwise.

    Resolves from the email claim in the verified JWT and from NOTHING in the request, so there
    is no identifier for a student to substitute. The nearest thing to a hole would be two
    records sharing an email, which the directory prevents: one login per email.
    """
    email = (claims(event).get('email') or '').strip().lower()
    if not email:
        return None, reply(403, {'error': 'Token carries no email claim'})

    # Scan, not a query: there is no GSI on studentEmail and the table holds one class,
    # not a population. Add one if that ever stops being true.
    matches = [s for s in StudentStore.scan()
               if (s.get('studentEmail') or '').strip().lower() == email]
    if not matches:
        return None, reply(404, {'error': 'No student record for this account'})
    return matches[0], None

#7. The student's own dashboard
def api_my_summary(event):
    """The caller's own record, reduced to what a student may see.

    AN ALLOWLIST, NOT A BLOCKLIST: the record also carries the ARNs of their execution role, deny
    policy and stop function, plus the admin's email - so adding a field to the table must not
    silently expose it here. Never refuses on status, because a suspended student needs this page
    precisely to find out that they are suspended; only the notebook link is gated.
    """
    student, error = _caller_student(event)
    if error:
        return error

    # Read the ledger, not the denormalised copy: "how much have I spent" is the number a
    # student refreshes the page to watch move, and a five-minute-old figure is the confusion
    # this page exists to remove.
    budget      = float(student.get('perStudentBudgetUsd') or DEFAULT_BUDGET_USD)
    spend       = UsageLedger.period_spend(student['studentId'])
    remaining   = max(0.0, budget - spend)

    return reply(200, {
        'studentId'             : student['studentId'],
        'givenName'             : student.get('givenName'),
        'familyName'            : student.get('familyName'),
        'studentEmail'          : student.get('studentEmail'),
        'status'                : student.get('status'),
        'onHoldReason'          : student.get('onHoldReason'),
        'provisioningStatus'    : student.get('provisioningStatus'),
        'computeStatus'         : student.get('computeStatus'),
        'instanceType'          : student.get('instanceType'),
        'perStudentBudgetUsd'   : student.get('perStudentBudgetUsd'),
        'currentSpendUsd'       : round(spend, 2),
        'percentUsed'           : percent_of(spend, budget),
        'remainingUsd'          : round(remaining, 2),
        'billingPeriod'         : period_of(),
        # Hours left at their provisioned instance type's rate - the one number a student
        # cannot work out themselves, because they do not know the rate.
        'hoursRemaining'        : round(remaining / Rates.hourly(
            student.get('instanceType') or DEFAULT_INSTANCE_TYPE)[0], 1),
        'hourlyRateUsd'         : Rates.hourly(student.get('instanceType') or DEFAULT_INSTANCE_TYPE)[0],
        'spendHistory'          : student.get('spendHistory') or [],
        'createdAt'             : student.get('createdAt'),
        'updatedAt'             : student.get('updatedAt'),
        # Worst-case lag between spending past the cap and being stopped. Published rather than
        # hidden: a student who overshoots by 40 cents deserves to know why.
        'enforcementLagMinutes' : SWEEP_MINUTES,
        # True when the notebook link will actually work, so the SPA can render one
        # button state instead of reimplementing the checks below and drifting from them.
        'canOpenNotebook'       : (student.get('status') not in ('SUSPENDED', 'ON_HOLD')
                                   and bool(student.get('userProfileName'))),
    })

#7b. The student's own consumption detail
def api_my_usage(event):
    """Session-level breakdown behind the summary's one number. Separate from GET /me because it
    is a Query per call and the summary is what loads first. Sessions are projected, not returned
    raw: the rows carry the internal sort key and space name, which are of no use to a student.
    """
    student, error = _caller_student(event)
    if error:
        return error
    student_id  = student['studentId']
    budget      = float(student.get('perStudentBudgetUsd') or DEFAULT_BUDGET_USD)
    period      = UsageLedger.period(student_id)
    spend       = float(period.get('accruedUsd') or 0)

    sessions = sorted(
        ({'appName'          : r.get('appName'),
          'appType'          : r.get('appType'),
          'instanceType'     : r.get('instanceType'),
          'hourlyRateUsd'    : r.get('hourlyRateUsd'),
          'startedAt'        : r.get('startedAt'),
          'lastSampledAt'    : r.get('lastSampledAt'),
          'hours'            : round(int(r.get('accruedSeconds') or 0) / 3600, 2),
          'accruedUsd'       : r.get('accruedUsd'),
          'status'           : r.get('status')}
         for r in UsageLedger.sessions(student_id)),
        key=lambda s: s.get('startedAt') or '', reverse=True)

    return reply(200, {
        'studentId'             : student_id,
        'billingPeriod'         : period.get('period') or period_of(),
        'perStudentBudgetUsd'   : student.get('perStudentBudgetUsd'),
        'currentSpendUsd'       : round(spend, 2),
        'percentUsed'           : percent_of(spend, budget),
        'remainingUsd'          : round(max(0.0, budget - spend), 2),
        'totalHours'            : round(int(period.get('accruedSeconds') or 0) / 3600, 2),
        'byInstanceType'        : period.get('byInstanceType') or {},
        'sessions'              : sessions,
        'spendHistory'          : student.get('spendHistory') or [],
        # What the cap does and does not cover, stated where a student will read it: metering
        # counts notebook hours only, so ~$0.56/month of Space storage sits outside it.
        'capCovers'             : 'Notebook compute hours only. Persistent storage is not counted.',
        'ratesAsOf'             : RATES_ASOF,
    })

#8. The student's own notebook link
def api_my_studio_url(event):
    """Presigned Studio URL for the CALLER's own UserProfile - ACCOUNT mode's replacement for the
    IdC portal tile. Refuses while suspended or over budget: the deny policy already blocks
    CreateApp, so a URL handed out here would open a Studio that cannot start a notebook.
    """
    student, error = _caller_student(event)
    if error:
        return error
    student_id = student['studentId']

    if student.get('status') in ('SUSPENDED', 'ON_HOLD'):
        return reply(403, {
            'error'     : 'Notebook access is currently suspended',
            'status'    : student.get('status'),
            'reason'    : student.get('onHoldReason') or 'Budget cap reached or manually suspended.',
        })

    domain_id       = student.get('domainId') or ssm_get('existing-domain-id')
    profile_name    = student.get('userProfileName')
    if not profile_name:
        return reply(409, {'error': 'Your environment is still being provisioned. Try again shortly.',
                           'status': student.get('provisioningStatus')})

    response = aws('sagemaker').create_presigned_domain_url(
        DomainId=domain_id, UserProfileName=profile_name,
    )
    print(f'api_my_studio_url: issued a presigned URL for {student_id} ({profile_name})')
    return reply(200, {
        'studentId'         : student_id,
        'userProfileName'   : profile_name,
        # Single-use and short-lived by design - the SPA should redirect straight to it
        # rather than storing it.
        'url'               : response['AuthorizedUrl'],
    })

#9. Manual enforcement override
@student_route(require_provisioned=True)
def api_suspend_student(event, student_id, student):
    Enforcement.suspend(student['executionRoleArn'], student['denyPolicyArn'], student['stopFunctionArn'])
    now = now_iso()
    StudentStore.update(student_id, {
        'status'            : 'SUSPENDED',
        'manualOverride'    : 'SUSPENDED',
        'onHoldAt'          : now,
        # HOLD_MANUAL, not HOLD_BUDGET: the rollover lifts budget holds automatically, and a
        # human's decision to suspend someone must outlive a calendar page.
        'onHoldKind'        : HOLD_MANUAL,
        'onHoldReason'      : f'Manually suspended by {caller_identity(event)}',
        'updatedAt'         : now,
    })
    return reply(200, {'studentId': student_id, 'status': 'SUSPENDED'})

@student_route(require_provisioned=True)
def api_resume_student(event, student_id, student):
    Enforcement.resume(student['executionRoleArn'], student['denyPolicyArn'])
    StudentStore.update(student_id, {
        'status'            : 'ACTIVE',
        'manualOverride'    : 'RESUMED',
        'onHoldKind'        : '',
        'onHoldReason'      : f'Resumed by {caller_identity(event)} at {now_iso()}',
        'updatedAt'         : now_iso(),
    })
    return reply(200, {'studentId': student_id, 'status': 'ACTIVE'})


""" 8. SCHEDULED JOBS """

def _for_each_student(job_name, fn, *, only_statuses=None):
    """One student's failure must never block the rest of the batch. A job has no caller to
    return a status code to, so it reports a manifest instead - processed, skipped, failed and
    why - which lands in the invocation result where a partial tick is legible.
    """
    manifest = {
        'job'       : job_name,
        'processed' : 0,
        'skipped'   : 0,
        'failed'    : 0,
        'errors'    : []
    }

    for student in StudentStore.scan():
        if only_statuses is not None and student.get('status') not in only_statuses:
            manifest['skipped'] += 1
            continue
        try:
            fn(student)
            manifest['processed'] += 1
        except Exception as e:
            manifest['failed'] += 1
            manifest['errors'].append({'studentId': student.get('studentId'), 'error': str(e)})
            print(f"{FAIL} {job_name}: failed for {student.get('studentId')}: {e}")

    print(f"{SUCCESS if not manifest['failed'] else FAIL} {job_name}: "
          f"{manifest['processed']} processed, {manifest['skipped']} skipped, {manifest['failed']} failed")

    return {'statusCode': 200, **manifest}

#1. Stack reconciliation
def job_stack_status_sync(event):
    """Reconcile each stack into DynamoDB, plus the one-time IdC group add at CREATE_COMPLETE.

    Also the reconciliation point between the console and the directory, in both directions: a
    record whose login was deleted out of band (below) and a login with no record
    (job_directory_audit). Polled rather than event-driven because Cognito has no user-deletion
    trigger at all, and polling also catches whatever happened while a rule was broken.
    """
    # One domain view for the whole batch, rather than the same list_apps pagination repeated
    # once per row in the table.
    snapshot = DomainSnapshot(ssm_get('existing-domain-id'))
    manifest = _for_each_student('stack_status_sync', lambda s: _sync_stack_one(s, snapshot))
    try:
        manifest.update(job_directory_audit())
    except Exception as e:
        # Never let the audit sink the tick it rides on - the reconciliation above is the part
        # that enforces anything.
        print(f'{FAIL} directory_audit: {e}')
        manifest['audit'] = f'failed: {e}'
    return manifest

def _sync_stack_one(student, snapshot=None):
    student_id  = student['studentId']
    stack       = StackService.describe(student['stackName'])

    if stack is None:
        if student.get('status') == 'DELETING':
            # Normal teardown: the stack and the UserProfile referencing this identity are gone.
            # Both calls precede StudentStore.delete deliberately - in ACCOUNT mode Directory
            # resolves the Cognito username out of that very record.
            Directory.remove_from_group(student_id)
            Directory.delete_user(student_id)
        # Non-DELETING + no stack means it vanished outside our delete flow: reconcile the record
        # but DON'T nuke the login identity. Also guards the create-time window where a
        # just-created stack is not describable yet.
        StudentStore.delete(student_id)
        return

    new_status  = stack['StackStatus']
    updates     = {}

    if new_status != student.get('provisioningStatus'):
        updates['provisioningStatus'] = new_status
        if new_status == 'CREATE_COMPLETE':
            outputs = {o['OutputKey']: o['OutputValue'] for o in stack.get('Outputs', [])}
            updates.update({
                'status'                : 'ACTIVE',
                'domainId'              : outputs.get('StudioDomainId'),
                'userProfileName'       : outputs.get('StudentUserProfileName'),
                'executionRoleArn'      : outputs.get('StudentExecutionRoleArn'),
                'denyPolicyArn'         : outputs.get('DenyNewAppsPolicyArn'),
                'stopFunctionArn'       : outputs.get('StopStudioAppFunctionArn'),
            })
        elif new_status in FAILED_STATUSES:
            updates['status'] = 'PROVISION_FAILED'

    if new_status == 'CREATE_COMPLETE':
        merged = {**student, **updates}
        # Retried every tick, not just on status change, so IdP sync lag gets picked up on a later pass.
        if not merged.get('groupMembershipAdded'):
            updates['groupMembershipAdded'] = Directory.add_to_group(student_id)
        # Real signals: whether the login identity is usable - the IdC account-enabled flag or the
        # Cognito UserStatus, neither of which means "verified" - and whether Studio is running.
        directory_status = Directory.status(student_id)
        if directory_status is not None:
            updates['directoryStatus'] = directory_status
        elif _login_was_deleted({**student, **updates}):
            # Writing the None matters: without it, a login deleted out of band leaves the
            # last-known value frozen in the record and the orphan is invisible - an ACTIVE
            # student with a live stack and a metering notebook that nobody can sign in to.
            updates.update(_revoke_for_deleted_login({**student, **updates}))
        compute_status = Enforcement.compute_status(
            merged.get('domainId'), merged.get('userProfileName'), snapshot)
        if compute_status is not None:
            updates['computeStatus'] = compute_status

    if updates:
        updates['updatedAt'] = now_iso()
        StudentStore.update(student_id, updates)

def _login_was_deleted(student):
    """Whether a None directory status means "deleted", not "not created yet".

    Keys off a status having been recorded BEFORE, which is what makes this safe on every tick:
    the stack can reach CREATE_COMPLETE a tick before the directory settles, and reading that
    window as a deletion would suspend every new student the moment they were provisioned.

    Also the idempotence latch - DIRECTORY_DELETED is excluded, so ops gets one alert rather
    than one every five minutes.
    """
    previous = student.get('directoryStatus')
    return bool(previous) and previous != DIRECTORY_DELETED

def _revoke_for_deleted_login(student):
    """Revoke access and stop the notebook, then return the record updates to apply.

    DELIBERATELY NOT A TEARDOWN. Deleting a user in the Cognito console says nothing about that
    student's notebook or the work in it, and a term's work lost to a mis-click elsewhere is not
    something an admin can hand back. So: deny, stop, mark, tell ops, and leave the stack for a
    human to delete on purpose. Stopping is reversible; DeleteStack is not.

    Stopping is also the part that matters for cost: a running app bills whether or not anyone
    can still sign in to reach it.
    """
    student_id  = student['studentId']
    directory   = 'Identity Center' if IS_ORG_MODE else 'the Cognito user pool'
    reason      = (f"Login identity for {student.get('studentEmail') or student_id} no longer "
                   f"exists in {directory} - it was deleted outside this console. Access has "
                   f"been revoked and any running notebook stopped. The student's stack, usage "
                   f"ledger and files are intact: restore the login to give access back, or delete "
                   f"the "
                   f"student properly to release the resources.")

    # Only if the stack got far enough to have something to enforce against - a login that
    # vanished mid-provision has no deny policy yet. tolerate() covers the teardown race.
    if all(student.get(k) for k in ('executionRoleArn', 'denyPolicyArn', 'stopFunctionArn')):
        with tolerate('NoSuchEntity', 'ResourceNotFoundException'):
            Enforcement.suspend(student['executionRoleArn'],
                                student['denyPolicyArn'],
                                student['stopFunctionArn'])

    Alerts.admin(f'Login deleted outside the console: {student_id}', reason)
    AlarmEventStore.record(student_id, 'DIRECTORY_IDENTITY_DELETED',
                           student.get('currentSpendUsd') or Decimal('0'),
                           student.get('perStudentBudgetUsd') or 0,
                           'Access revoked, Studio apps stopped', 'SUSPENDED')
    print(f'{FAIL} stack_status_sync: {student_id} login missing from {directory} - suspended')

    return {
        'directoryStatus'   : DIRECTORY_DELETED,
        # SUSPENDED rather than the breach path's ON_HOLD: this is an access problem, not a spend
        # one, and it needs a human. It drops them out of ACTIVE_STATUSES so job_usage_sync stops
        # polling them - correct, since we have just stopped anything that could spend.
        'status'            : 'SUSPENDED',
        'onHoldAt'          : now_iso(),
        # HOLD_DIRECTORY so nothing lifts this automatically: the rollover clears budget holds,
        # and the 1st must not restore access to an identity somebody deliberately deleted.
        'onHoldKind'        : HOLD_DIRECTORY,
        'onHoldReason'      : reason,
    }

#2. Reverse directory audit - a login with access but no record
def job_directory_audit():
    """The mirror of the sweep above, and READ-ONLY on purpose: it names orphan logins and stops.
    Deleting an unrecognised user from a pool the admins also live in is how the wrong account
    gets removed, and the membership alone grants nothing anyway - GET /me/studio-url still needs
    a record with a userProfileName, so an unenrolled login is inert.
    """
    members = Directory.group_member_emails()
    if members is None:
        return {'audit': 'skipped'}

    enrolled = {(s.get('studentEmail') or '').strip().lower() for s in StudentStore.scan()}
    orphans  = sorted(members - enrolled - {''})
    if orphans:
        # Count only. This printed the addresses themselves until 2026-09-03, which accumulated a
        # list of real ones in a group retained for months and readable by anyone holding
        # logs:FilterLogEvents. The addresses add nothing here: acting on this means looking at
        # the group membership anyway, which is where they already are, and they are returned in
        # orphanLogins below. No alert either - this rides the reconciliation tick, so it would
        # fire every sweep for as long as one orphan exists.
        print(f'{FAIL} directory_audit: {len(orphans)} login(s) can reach the student routes '
              f'with no student record')
    return {'audit': 'ok', 'orphanLogins': orphans}

#3. Metering and enforcement
def job_usage_sync(event):
    """Every SWEEP_MINUTES: meter every active student's running notebooks, then enforce the cap.

    THIS IS THE ENFORCEMENT MECHANISM, not a report on one - nothing else evaluates the cap. Why
    it is metered here rather than by AWS Budgets, which cost $3.04/student/month for data three
    refreshes a day stale: docs/COSTING.md §4.1-4.2.

    ORDER MATTERS. Meter first, enforce second, alert third: a student is never told they were
    stopped before the ledger says why, and the ledger is never ahead of what was billed.
    """
    snapshot = DomainSnapshot(ssm_get('existing-domain-id'))
    manifest = _for_each_student('usage_sync', lambda s: _sync_usage_one(s, snapshot),
                                 only_statuses=ACTIVE_STATUSES)
    try:
        manifest.update(_check_class_pool())
    except Exception as e:
        # The class-wide backstop is advisory; the per-student cap above is the one that binds.
        print(f'{FAIL} class_pool_check: {e}')
        manifest['classPool'] = f'failed: {e}'
    return manifest

def _sync_usage_one(student, snapshot):
    student_id  = student['studentId']
    budget_usd  = float(student.get('perStudentBudgetUsd') or 0)
    spend, _    = Meter.sample(student, snapshot)
    percent     = round((spend / budget_usd) * 100, 1) if budget_usd > 0 else 0
    spend_dec   = usd(spend)
    today       = day_of()

    # One point per calendar day, not per tick - a 14-day trend needs daily granularity, not noise.
    history = list(student.get('spendHistory') or [])
    point   = {'date': today, 'spend': spend_dec}
    if history and history[-1].get('date') == today:
        history[-1] = point
    else:
        history.append(point)

    updates = {
        'currentSpendUsd'   : spend_dec,
        'percentUsed'       : Decimal(str(percent)),
        'usagePeriod'       : period_of(),
        'usageUpdatedAt'    : now_iso(),
        'spendHistory'      : history[-SPEND_HISTORY_MAX_DAYS:],
        'updatedAt'         : now_iso(),
    }
    compute = snapshot.compute_status(student.get('userProfileName'))
    if compute is not None:
        updates['computeStatus'] = compute

    if percent >= BREACH_THRESHOLD_PCT and student.get('status') != 'ON_HOLD':
        updates.update(_enforce_breach(student, spend, budget_usd, percent))
    elif percent >= WARNING_THRESHOLD_PCT and not student.get('warnedAt80'):
        updates['warnedAt80'] = True
        Alerts.admin(
            f'Budget warning (80%): {student_id}',
            f'Student {student_id} has spent ${spend:.2f} of ${budget_usd:.2f} ({percent}%). '
            f'Notebooks are still running; they will be stopped automatically at 100%.',
        )
        AlarmEventStore.record(student_id, 'THRESHOLD_80_APPROACHING', spend_dec, budget_usd,
                               'Notification sent', 'APPROACHING_LIMIT')
    # Warned at 80%, then back under it - which only happens when someone raises the cap.
    # Clearing the latch means the next approach warns again instead of sailing past silently.
    elif percent < WARNING_THRESHOLD_PCT and student.get('warnedAt80'):
        updates['warnedAt80'] = False

    StudentStore.update(student_id, updates)

def _enforce_breach(student, spend, budget_usd, percent):
    """Block new sessions and stop the running one. Returns the record updates to apply.

    Nothing else is watching, so a failure here is a student spending without a ceiling. Hence it
    alerts loudly and leaves the record UN-HELD rather than marking a hold that never happened: a
    record claiming ON_HOLD over a running notebook is worse than an honest failure.
    """
    student_id  = student['studentId']
    now         = now_iso()
    reason      = (f'Cap reached: ${spend:.2f} of ${budget_usd:.2f} ({percent}%) metered this '
                   f'billing period ({period_of()}). New notebook sessions are denied and any '
                   f'running notebook has been stopped. Files and storage are untouched. The cap '
                   f'resets at the start of next month, or an admin can raise it now.')

    if not all(student.get(k) for k in ('executionRoleArn', 'denyPolicyArn', 'stopFunctionArn')):
        # Over cap with nothing to enforce against - a half-provisioned stack. Say so rather
        # than pretend to have held them.
        Alerts.admin(f'Cap reached but NOT enforceable: {student_id}',
                     f'{reason}\n\nThe student stack is missing its enforcement outputs, so the '
                     f'deny policy could not be attached. Check stack {student.get("stackName")}.')
        print(f'{ERROR} usage_sync: {student_id} over cap with no enforcement handles')
        return {}

    try:
        Enforcement.suspend(student['executionRoleArn'],
                            student['denyPolicyArn'],
                            student['stopFunctionArn'])
    except Exception as e:
        Alerts.admin(f'ENFORCEMENT FAILED at cap: {student_id}',
                     f'{reason}\n\nAttaching the deny policy or stopping the notebook FAILED: {e}\n'
                     f'The student is still able to spend. Intervene manually.')
        print(f'{ERROR} usage_sync: enforcement failed for {student_id}: {e}')
        raise

    Alerts.admin(f'Cap reached, access blocked: {student_id}', reason)
    AlarmEventStore.record(student_id, 'BUDGET_THRESHOLD_BREACHED', usd(spend), budget_usd,
                           'Deny policy attached, Studio apps stopped', 'ON_HOLD')
    ConsumptionLog.write([{'event': 'enforced', 'studentId': student_id, 'period': period_of(),
                           'periodUsd': round(spend, 4), 'capUsd': budget_usd,
                           'percentUsed': percent, 'action': 'suspend'}])
    print(f'{FAIL} usage_sync: {student_id} hit the cap at ${spend:.2f}/${budget_usd:.2f} - suspended')
    return {'status'        : 'ON_HOLD',
            'onHoldAt'      : now,
            'onHoldKind'    : HOLD_BUDGET,
            'onHoldReason'  : reason}

#4. Class-wide backstop - what the trimester pool budget used to be
def _check_class_pool():
    """Sum every student's period spend against the class cap. NOTIFY-ONLY, deliberately: locking
    a whole cohort out unattended, on a number one runaway notebook can move, is not a decision
    to automate. The per-student caps are the binding control; this catches what they cannot -
    thirty students each legitimately under $80 still adding up past what was set aside.
    """
    if CLASS_POOL_CAP_USD <= 0:
        return {'classPool': 'disabled'}

    period  = period_of()
    total   = sum(UsageLedger.period_spend(s['studentId'], period) for s in StudentStore.scan())
    percent = round(total / CLASS_POOL_CAP_USD * 100, 1)
    if percent >= WARNING_THRESHOLD_PCT:
        Alerts.admin(f'Class pool at {percent}% of ${CLASS_POOL_CAP_USD:.0f}',
                     f'Metered class spend for {period} is ${total:.2f} against a pool of '
                     f'${CLASS_POOL_CAP_USD:.2f} ({percent}%). Per-student caps are still '
                     f'enforced individually; this is the class-wide total.')
        AlarmEventStore.record('CLASS_POOL', 'POOL_THRESHOLD_APPROACHING', usd(total),
                               CLASS_POOL_CAP_USD, 'Notification sent',
                               'BREACHED' if percent >= BREACH_THRESHOLD_PCT else 'APPROACHING_LIMIT')
    return {'classPool': {'period': period, 'spendUsd': round(total, 2),
                          'capUsd': CLASS_POOL_CAP_USD, 'percentUsed': percent}}

#5. Month rollover - the cap resets, and budget holds lift with it
def job_period_rollover(event):
    """Lift holds that only existed because of last month's spend.

    The reset itself needs no work - a new month means a new PERIOD# row, so spend reads zero.
    What does need work is the deny policy, which hangs off an IAM role and does not know what
    month it is: without this, a student who hit their cap in August is still blocked in September.

    ONLY HOLD_BUDGET holds are lifted. A manual suspension and a deleted login are decisions
    about a person, and a calendar page turning is not new information about either - which is
    the whole reason onHoldKind exists.
    """
    lifted, skipped, failed = [], [], []
    for student in StudentStore.scan():
        student_id = student['studentId']
        if student.get('status') != 'ON_HOLD':
            continue
        if student.get('onHoldKind', HOLD_BUDGET) != HOLD_BUDGET:
            skipped.append(student_id)
            continue
        if UsageLedger.period_spend(student_id) >= float(student.get('perStudentBudgetUsd') or 0) > 0:
            skipped.append(student_id)      # already over this month's cap - nothing to lift
            continue
        if not all(student.get(k) for k in ('executionRoleArn', 'denyPolicyArn')):
            skipped.append(student_id)
            continue
        try:
            Enforcement.resume(student['executionRoleArn'], student['denyPolicyArn'])
            StudentStore.update(student_id, {
                'status'        : 'ACTIVE',
                'warnedAt80'    : False,
                'onHoldKind'    : '',
                'onHoldReason'  : f'Budget hold lifted automatically for {period_of()}.',
                'currentSpendUsd': Decimal(0),
                'percentUsed'   : 0,
                'usagePeriod'   : period_of(),
                'updatedAt'     : now_iso(),
            })
            lifted.append(student_id)
        except Exception as e:
            failed.append({'studentId': student_id, 'error': str(e)})
            print(f'{FAIL} period_rollover: could not lift the hold on {student_id}: {e}')

    if lifted:
        Alerts.admin(f'{len(lifted)} budget hold(s) lifted for {period_of()}',
                     'Access restored at the start of the new billing period for: '
                     + ', '.join(lifted))
    print(f'{SUCCESS if not failed else FAIL} period_rollover: {len(lifted)} lifted, '
          f'{len(skipped)} skipped, {len(failed)} failed')
    return {'statusCode': 200, 'job': 'period_rollover', 'period': period_of(),
            'lifted': lifted, 'skipped': skipped, 'failed': failed}


""" 9. FACADE REQUIRED BY handler() """
# The dispatchers below are frozen and have no try/except, so this is both the only mapping to
# the names they call and the only place an error boundary can live.

def guarded(fn):
    """Unhandled exception -> readable JSON 500 + CloudWatch traceback, not a bare empty-body 502.
    The inverse of a log-and-continue collector: an HTTP caller acts on the status code, so a
    half-applied mutation must never be reported as 200.
    """
    @wraps(fn)
    def wrapper(event):
        if MISSING_ENV:
            return reply(500, {'error': 'Unset environment variables: ' + ', '.join(MISSING_ENV)})
        try:
            return fn(event)
        except Exception as e:
            traceback.print_exc()
            return reply(500, {'error': f'{type(e).__name__}: {e}'})
    return wrapper

def guarded_admin_check(event):
    """Called outside guarded(), so log and raise: an SSM/directory failure here is config, not a "not an admin" answer."""
    if MISSING_ENV:
        raise RuntimeError('Unset environment variables: ' + ', '.join(MISSING_ENV))
    try:
        return Directory.is_admin(event)
    except Exception:
        traceback.print_exc()
        raise

def guarded_student_check(event):
    """Same contract as guarded_admin_check, for the one route students may call themselves."""
    if MISSING_ENV:
        raise RuntimeError('Unset environment variables: ' + ', '.join(MISSING_ENV))
    try:
        return Directory.is_student(event)
    except Exception:
        traceback.print_exc()
        raise

auth        = SimpleNamespace(is_admin=guarded_admin_check,
                              is_student=guarded_student_check)
responses   = SimpleNamespace(json_response=reply)
platform    = SimpleNamespace(get_platform_info=guarded(api_platform_info))
alarms      = SimpleNamespace(list_alarm_events=guarded(api_list_alarm_events))
budget      = SimpleNamespace(update_budget=guarded(api_update_budget))
suspend     = SimpleNamespace(suspend_student=guarded(api_suspend_student),
                              resume_student=guarded(api_resume_student))
students    = SimpleNamespace(list_students=guarded(api_list_students),
                              get_student=guarded(api_get_student),
                              add_student=guarded(api_add_student),
                              delete_student=guarded(api_delete_student))
sync        = SimpleNamespace(stack_status_sync=guarded(job_stack_status_sync),
                              usage_sync=guarded(job_usage_sync),
                              period_rollover=guarded(job_period_rollover))
me          = SimpleNamespace(summary=guarded(api_my_summary),
                              usage=guarded(api_my_usage),
                              studio_url=guarded(api_my_studio_url))
# init is unauthenticated and whoami answers for both audiences, so neither belongs behind a
# group namespace - see their handlers for why that is acceptable.
public      = SimpleNamespace(init=guarded(api_init))
identity    = SimpleNamespace(whoami=guarded(api_whoami))


def handler(event, context):
    """Single-Lambda dispatcher. Routes on event shape:
    - HTTP API request  -> event["routeKey"] is set
    - EventBridge job    -> event["job"] is set

    No SNS-triggered path and no AWS Budgets involvement: usage_sync meters Studio runtime,
    decides breach from its own ledger, and enforces. NOTHING OUTSIDE THIS LAMBDA EVALUATES THE
    CAP, which is why _enforce_breach shouts rather than shrugs when it cannot act.
    """
    # Cached per container. A mandatory client that cannot be reached means every route would
    # 500 anyway, so say so once, clearly, instead of per-route.
    if RUN_PREFLIGHT and not preflight():
        return reply(503, {'error': 'Preflight failed: a mandatory AWS client is unreachable. See logs.'})

    route_key = event.get('routeKey')
    if route_key:
        return _dispatch_http(route_key, event)

    job = event.get('job')
    if job:
        return _dispatch_job(job, event)

    return {
        'statusCode': 400,
        'body': json.dumps({'error': 'Unrecognized event shape'}),
    }


def _dispatch_http(route_key, event):
    # GET /init is unauthenticated and MUST be matched before any authorization check - it is
    # what the SPA calls to draw a login page, so there is no token yet, and its route in the
    # template carries no AuthorizerId. See api_init for what an open response may contain.
    if route_key == 'GET /init':
        return public.init(event)

    # Authenticated, both audiences: which screen the caller belongs on. Above the student gate
    # because an admin must get a truthful answer too, below /init because it needs a token.
    if route_key == 'GET /whoami':
        return identity.whoami(event)

    # /me/* is the only non-admin surface. Checked BEFORE the admin gate below, and against the
    # student group rather than skipping authorization - an admin is not in the student group and
    # has no UserProfile, so these deliberately are not open to them.
    if route_key in ('GET /me', 'GET /me/usage', 'GET /me/studio-url'):
        if not auth.is_student(event):
            return responses.json_response(403, {'error': 'Not a member of the student group'})
        if route_key == 'GET /me':
            return me.summary(event)
        return me.usage(event) if route_key == 'GET /me/usage' else me.studio_url(event)

    # Layer 1, the JWT authorizer, only proves the caller signed in - it says nothing about
    # which group they are in. Every remaining route requires AdminGroup membership, in code.
    if not auth.is_admin(event):
        return responses.json_response(403, {'error': 'Not a member of the admin group'})

    if route_key == 'GET /platform-info':
        return platform.get_platform_info(event)
    if route_key == 'GET /students':
        return students.list_students(event)
    if route_key == 'GET /students/{studentId}':
        return students.get_student(event)
    if route_key == 'POST /students':
        return students.add_student(event)
    if route_key == 'DELETE /students/{studentId}':
        return students.delete_student(event)
    if route_key == 'PUT /students/{studentId}/budget':
        return budget.update_budget(event)
    if route_key == 'POST /students/{studentId}/suspend':
        return suspend.suspend_student(event)
    if route_key == 'POST /students/{studentId}/resume':
        return suspend.resume_student(event)
    if route_key == 'GET /alarm-events':
        return alarms.list_alarm_events(event)
    return {
        'statusCode': 404,
        'body': json.dumps({'error': f'No route for {route_key}'}),
    }


def _dispatch_job(job, event):
    if job == 'stack_status_sync':
        return sync.stack_status_sync(event)
    if job == 'usage_sync':
        return sync.usage_sync(event)
    if job == 'period_rollover':
        return sync.period_rollover(event)
    return {
        'statusCode': 400,
        'body': json.dumps({'error': f'Unknown job {job}'}),
    }


""" 10. LOCAL DEVELOPMENT HARNESS """

if __name__ == "__main__":

    """ 1. Preflight only - confirm credentials, IAM and the SSM bootstrap. """
    ok = preflight()
    print("*" * 15, "Connected" if ok else "Not Connected", "*" * 15)

    if ok:
        """ 2. Run a scheduled job locally. stack_status_sync is read-mostly; usage_sync and
        period_rollover WRITE - they meter into the ledger and attach or detach the deny policy
        on a real IAM role. Point at a dev account, never prod. """
        #print(json.dumps(handler({"job": "stack_status_sync"}, None), indent=2, cls=DecimalEncoder))
        #print(json.dumps(handler({"job": "usage_sync"}, None), indent=2, cls=DecimalEncoder))
        #print(json.dumps(handler({"job": "period_rollover"}, None), indent=2, cls=DecimalEncoder))

        """ 3. Simulate an HTTP route. The email must be in the admin group of whichever
        directory IDENTITY_MODE selects, since _dispatch_http runs the same Layer 2 check it does
        in Lambda. The /me routes want a student's email instead; "GET /init" needs no claims. """
        event = {
            "routeKey"          : "GET /students",
            "requestContext"    : {"authorizer": {"jwt": {"claims": {"email": "you@example.com"}}}},
        }
        #print(json.dumps(handler(event, None), indent=2, cls=DecimalEncoder))

    print("*" * 14, "Disconnected", "*" * 13)
