/* Hourly reminders.
 * Android build: Capacitor LocalNotifications, repeating every hour, survives app close.
 * Browser/PWA: Notification API driven by a one-minute heartbeat while the app is open.
 * Either way the employee can only switch reminders off during night hours. */

const Reminders = (() => {
  const NOTIF_ID = 4101;
  let night = { start: 21, end: 6 };
  let state = { pending: 0, muteUntil: null };

  const LN = () => window.Capacitor?.Plugins?.LocalNotifications || null;

  function isNight(d = new Date()) {
    const h = d.getHours();
    return night.start > night.end ? (h >= night.start || h < night.end) : (h >= night.start && h < night.end);
  }

  function muted() {
    return state.muteUntil && new Date(state.muteUntil) > new Date();
  }

  function body() {
    return state.pending === 1
      ? '1 site is still waiting for its reading.'
      : `${state.pending} sites are still waiting for their readings.`;
  }

  async function ensurePermission() {
    const ln = LN();
    if (ln) {
      const res = await ln.requestPermissions();
      return res.display === 'granted';
    }
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    return (await Notification.requestPermission()) === 'granted';
  }

  async function schedule() {
    const ln = LN();
    if (!ln) return;
    await ln.cancel({ notifications: [{ id: NOTIF_ID }] });
    if (!state.pending || muted()) return;
    const first = new Date();
    first.setHours(first.getHours() + 1, 0, 0, 0);
    await ln.schedule({
      notifications: [{
        id: NOTIF_ID,
        title: 'Readings pending',
        body: body(),
        schedule: { at: first, every: 'hour', allowWhileIdle: true },
        smallIcon: 'ic_stat_icon',
        channelId: 'fieldops-jobs',
      }],
    });
  }

  function fireNow() {
    if (!state.pending || muted()) return;
    if (LN()) {
      LN().schedule({ notifications: [{ id: NOTIF_ID + 1, title: 'Readings pending', body: body() }] });
    } else if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Readings pending', { body: body(), tag: 'fieldops-jobs', renotify: true });
    }
  }

  function heartbeat() {
    // Browser fallback: fire on the hour.
    setInterval(() => {
      const now = new Date();
      if (now.getMinutes() === 0 && !LN()) fireNow();
    }, 60000);
  }

  return {
    async init(opts) {
      night = opts.night || night;
      state.pending = opts.pending || 0;
      state.muteUntil = opts.muteUntil || null;
      if (LN()) {
        await LN().createChannel?.({
          id: 'fieldops-jobs', name: 'Job reminders',
          importance: 4, visibility: 1, vibration: true,
        });
      }
      await ensurePermission();
      await schedule();
      heartbeat();
    },
    async update({ pending, muteUntil }) {
      if (pending !== undefined) state.pending = pending;
      if (muteUntil !== undefined) state.muteUntil = muteUntil;
      await schedule();
    },
    async clear() {
      if (LN()) await LN().cancel({ notifications: [{ id: NOTIF_ID }] });
    },
    isNight, muted, ensurePermission,
    get nightWindow() { return night; },
  };
})();
