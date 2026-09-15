"use client";

import { listAlarmEvents } from "@/lib/api/students";
import type { AlarmEvent } from "@/lib/api/types";
import { type PolledResult, usePolled } from "./usePolled";

/** Separate key from the fleet: a different endpoint, deduped independently. */
export const ALARM_EVENTS_KEY = "fleet/alarm-events";

const NO_EVENTS: AlarmEvent[] = [];

export interface UseAlarmEventsResult
  extends Omit<PolledResult<AlarmEvent[]>, "data"> {
  events: AlarmEvent[];
}

export function useAlarmEvents(): UseAlarmEventsResult {
  const { data, ...rest } = usePolled(
    ALARM_EVENTS_KEY,
    listAlarmEvents,
    NO_EVENTS,
  );
  return { events: data, ...rest };
}
