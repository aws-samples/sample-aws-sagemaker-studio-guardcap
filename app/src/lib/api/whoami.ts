import { request } from "./client";
import type { WhoAmI } from "./types";

/**
 * GET /whoami - which audience this token belongs to.
 *
 * The only authenticated route open to both audiences, and it exists so this app
 * stops guessing. It used to read `cognito:groups` off the id token, which is
 * absent under ORGANIZATION mode where groups live in Identity Center and never
 * reach the token, and otherwise learned the answer by calling an admin route and
 * watching for a 403 - an authorization decision inferred from a failure.
 *
 * The backend answers from the groups it can actually see, and says where to land
 * the user. Admin wins when they are in both groups.
 */
export async function getWhoAmI(): Promise<WhoAmI> {
  return request<WhoAmI>("/whoami");
}
