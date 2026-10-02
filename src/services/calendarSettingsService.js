// Calendar settings service — stores the admin-controlled Hijri moon-sighting
// adjustment used by hijriService.js. Mirrors the data shape used by the
// Community Events App (settings/hijriCalendar) so the two stay compatible:
//   overrides: [{ hYear, hMonth, gDate }]  — per-month community observations
//   adjustmentDays: number                  — legacy single offset (back-compat)
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase/firebase';

const SETTINGS_DOC = 'hijri';

export const DEFAULT_HIJRI_SETTINGS = { overrides: [], adjustmentDays: 0 };

export async function getHijriSettings() {
  try {
    const snap = await getDoc(doc(db, 'calendarSettings', SETTINGS_DOC));
    if (!snap.exists()) return { ...DEFAULT_HIJRI_SETTINGS };
    const data = snap.data();
    return {
      overrides: data.overrides || [],
      adjustmentDays: data.adjustmentDays ?? 0
    };
  } catch {
    return { ...DEFAULT_HIJRI_SETTINGS };
  }
}

/** Admin only (enforced by firestore.rules). Upserts a single month override. */
export async function saveMonthOverride(hYear, hMonth, gDate, adjustedBy) {
  const current = await getHijriSettings();
  const overrides = [
    ...(current.overrides || []).filter(
      o => !(Number(o.hYear) === Number(hYear) && Number(o.hMonth) === Number(hMonth))
    ),
    { hYear: Number(hYear), hMonth: Number(hMonth), gDate }
  ];
  await setDoc(
    doc(db, 'calendarSettings', SETTINGS_DOC),
    { overrides, adjustedBy: adjustedBy || null, updatedAt: new Date().toISOString() },
    { merge: true }
  );
  return overrides;
}

export async function removeMonthOverride(hYear, hMonth) {
  const current = await getHijriSettings();
  const overrides = (current.overrides || []).filter(
    o => !(Number(o.hYear) === Number(hYear) && Number(o.hMonth) === Number(hMonth))
  );
  await setDoc(doc(db, 'calendarSettings', SETTINGS_DOC), { overrides }, { merge: true });
  return overrides;
}
