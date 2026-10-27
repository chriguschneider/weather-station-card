// Real `sun.sun` state, read from a Home Assistant 2026.10 instance on
// 2026-10-27 09:21 local time (Europe/Zurich). Home location:
// latitude 46.92176, longitude 7.41960. Kept exactly as read.
export const SUN_SUN_HOME = { latitude: 46.92176, longitude: 7.41960 };

export const SUN_SUN = {
  entity_id: 'sun.sun',
  state: 'above_horizon',
  attributes: {
    next_dawn: '2026-10-28T05:30:09.488332+00:00',
    next_dusk: '2026-10-27T16:58:48.705455+00:00',
    next_midnight: '2026-10-27T23:14:04+00:00',
    next_noon: '2026-10-27T11:14:11+00:00',
    next_rising: '2026-10-28T06:03:22.032187+00:00',
    next_setting: '2026-10-27T16:25:43.197968+00:00',
    elevation: 18.98,
    azimuth: 135.28,
    rising: true,
    friendly_name: 'Sun',
  },
};
