import { expect, test } from "bun:test";
import { getProfile, SENSITIVE_COLUMNS } from "../lib/profiles";
import { assessRisk } from "../lib/sql-guard";

test("traite le superviseur comme une identité sensible", () => {
  expect(SENSITIVE_COLUMNS).toContain("supervisor");
  const seniorVerdict = assessRisk(
    "SELECT supervisor FROM SECAUDIT.USER_PROFILES WHERE user_profile = 'FAW0032'",
    getProfile("soc-senior").policy,
  );
  expect(seniorVerdict).toMatchObject({ risky: true });
  expect(seniorVerdict.blocked).not.toBe(true);
  expect(
    assessRisk("SELECT * FROM SECAUDIT.USER_PROFILES", getProfile("soc-junior").policy),
  ).toMatchObject({ risky: true, blocked: true });
});
