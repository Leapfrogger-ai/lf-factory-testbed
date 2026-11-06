// Enhances the create and published pages. Without it every card row is a plain input
// and every form is a plain POST, so nothing here is required for the pages to work.
(() => {
  'use strict';

  const HOUR_MS = 60 * 60 * 1000;
  const MINUTE_MS = 60 * 1000;
  const SPINNER_TEXT = ['Finding something nearby…', 'Picking a time…'];

  // --- Decide by, mirroring defaultDeadline in src/domain/plan-rules.ts ---
  // Plain wall-clock arithmetic: wall-clock fields are read as if they were UTC, so DST
  // is ignored (see the plan's Ruling). The server stays authoritative.

  /** "2026-11-14" and "10:00" as wall-clock milliseconds, or null if either is not filled in. */
  function wallClockMs(date, time) {
    const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    const t = /^(\d{2}):(\d{2})/.exec(time);
    if (!d || !t) return null;
    return Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]));
  }

  /** The browser's current local wall-clock as wall-clock milliseconds. */
  function nowWallClockMs(now) {
    return Date.UTC(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      now.getHours(),
      now.getMinutes(),
      now.getSeconds(),
      now.getMilliseconds(),
    );
  }

  /** The earlier of 48 h before When and halfway to it, or halfway if that is already past; floored to the minute. */
  function defaultDeadline(nowMs, whenMs) {
    const halfway = nowMs + (whenMs - nowMs) / 2;
    const fortyEightBefore = whenMs - 48 * HOUR_MS;
    const earliest = fortyEightBefore < halfway ? fortyEightBefore : halfway;
    const chosen = earliest > nowMs ? earliest : halfway;
    return Math.floor(chosen / MINUTE_MS) * MINUTE_MS;
  }

  const pad = (n) => String(n).padStart(2, '0');

  /** Wall-clock milliseconds back to the date and time input values. */
  function toFields(ms) {
    const d = new Date(ms);
    return {
      date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
      time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
    };
  }
  // --- end of Decide by ---

  const byId = (id) => document.getElementById(id);

  // --- Card rows: Edit / Done ---
  function summaryOf(row) {
    const values = Array.from(row.querySelectorAll('input'))
      .map((input) => input.value)
      .filter((value) => value !== '');
    return values.join(' ');
  }

  const ROW_NAMES = { where: 'Where', when: 'When', minimum: 'Minimum', decide: 'Decide by' };

  function enhanceRow(row, startOpen) {
    const field = row.dataset.field;
    const name = ROW_NAMES[field] || field;
    // The server's display text (UX §8.8), shown until this row's inputs change.
    let serverSummary = row.dataset.summary;
    const text = () => (serverSummary !== undefined ? serverSummary : summaryOf(edit));

    const edit = document.createElement('div');
    edit.className = 'row-edit';
    while (row.firstChild) edit.appendChild(row.firstChild);

    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'btn btn-secondary';
    done.textContent = 'Done';
    edit.appendChild(done);

    const view = document.createElement('div');
    view.className = 'row-view';
    const viewLabel = document.createElement('span');
    viewLabel.className = 'row-label';
    viewLabel.textContent = name;
    const summary = document.createElement('span');
    summary.className = 'row-summary';
    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'quiet';
    editButton.textContent = 'Edit';
    editButton.setAttribute('aria-label', `Edit ${name.toLowerCase()}`);
    view.append(viewLabel, summary, editButton);

    row.append(view, edit);

    const open = () => {
      view.hidden = true;
      edit.hidden = false;
      const first = edit.querySelector('input');
      if (first) first.focus();
    };
    const close = () => {
      summary.textContent = text();
      edit.hidden = true;
      view.hidden = false;
      editButton.focus();
    };

    editButton.addEventListener('click', open);
    done.addEventListener('click', close);
    edit.addEventListener('input', () => (serverSummary = undefined));
    edit.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    });

    summary.textContent = text();
    view.hidden = startOpen;
    edit.hidden = !startOpen;

    // Called after the script set this row's inputs itself, which fires no input event.
    return {
      refresh: () => {
        serverSummary = undefined;
        summary.textContent = text();
      },
    };
  }

  // --- Publish form: rows, Decide by recompute, disable on submit ---
  const publishForm = document.querySelector('form[data-publish-form]');
  if (publishForm) {
    const isFallback = publishForm.dataset.publishForm === 'fallback';
    const rows = {};
    publishForm.querySelectorAll('.row-field[data-field]').forEach((row) => {
      const hasError = row.querySelector('[aria-invalid="true"]') !== null;
      rows[row.dataset.field] = enhanceRow(row, isFallback || hasError);
    });

    const date = byId('date');
    const time = byId('time');
    const deadlineDate = byId('deadlineDate');
    const deadlineTime = byId('deadlineTime');
    if (date && time && deadlineDate && deadlineTime) {
      let deadlineEdited = false;
      const markEdited = () => (deadlineEdited = true);
      deadlineDate.addEventListener('input', markEdited);
      deadlineTime.addEventListener('input', markEdited);

      const recompute = () => {
        if (deadlineEdited) return;
        const whenMs = wallClockMs(date.value, time.value);
        if (whenMs === null) return;
        const fields = toFields(defaultDeadline(nowWallClockMs(new Date()), whenMs));
        deadlineDate.value = fields.date;
        deadlineTime.value = fields.time;
        if (rows.decide) rows.decide.refresh();
      };
      date.addEventListener('change', recompute);
      time.addEventListener('change', recompute);
    }

    const publishButton = publishForm.querySelector('button[type="submit"]');
    publishForm.addEventListener('submit', (event) => {
      if (publishForm.dataset.submitting === 'true') {
        event.preventDefault();
        return;
      }
      publishForm.dataset.submitting = 'true';
      // Disable after the submit has started, so the POST still goes out.
      if (publishButton) setTimeout(() => (publishButton.disabled = true), 0);
    });
    window.addEventListener('pageshow', (event) => {
      if (!event.persisted) return;
      delete publishForm.dataset.submitting;
      if (publishButton) publishButton.disabled = false;
    });
  }

  // --- Suggest forms: disable and rotate the button text ---
  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelectorAll('form[data-suggest-form]').forEach((form) => {
    const button = form.querySelector('button[type="submit"]');
    if (!button) return;
    // The live region exists before its text changes, so the change is announced.
    const live = document.createElement('span');
    live.setAttribute('aria-live', 'polite');
    live.textContent = button.textContent.trim();
    button.textContent = '';
    button.appendChild(live);

    const label = live.textContent;
    let timer = null;

    form.addEventListener('submit', (event) => {
      if (form.dataset.submitting === 'true') {
        event.preventDefault();
        return;
      }
      form.dataset.submitting = 'true';
      let step = 0;
      live.textContent = SPINNER_TEXT[step];
      setTimeout(() => (button.disabled = true), 0);
      if (!reducedMotion) {
        timer = setInterval(() => {
          step = (step + 1) % SPINNER_TEXT.length;
          live.textContent = SPINNER_TEXT[step];
        }, 2000);
      }
    });

    // Coming back to this page from the browser's cache: put the button back.
    window.addEventListener('pageshow', (event) => {
      if (!event.persisted) return;
      clearInterval(timer);
      delete form.dataset.submitting;
      button.disabled = false;
      live.textContent = label;
    });
  });

  // --- Published page: Copy and Share… ---
  const link = byId('public-link');
  const copy = byId('copy');
  const share = byId('share');
  const copyStatus = byId('copy-status');

  if (link && copy) {
    let restore = null;
    const selectLink = () => {
      link.focus();
      link.select();
    };
    copy.addEventListener('click', () => {
      if (!navigator.clipboard || !navigator.clipboard.writeText) {
        selectLink();
        return;
      }
      navigator.clipboard.writeText(link.value).then(
        () => {
          copy.textContent = 'Copied';
          if (copyStatus) copyStatus.textContent = 'Copied';
          clearTimeout(restore);
          restore = setTimeout(() => {
            copy.textContent = 'Copy';
            if (copyStatus) copyStatus.textContent = '';
          }, 2000);
        },
        selectLink,
      );
    });
  }

  if (link && share && typeof navigator.share === 'function') {
    share.hidden = false;
    share.addEventListener('click', () => {
      navigator.share({ text: share.dataset.shareText, url: link.value }).catch(() => {});
    });
  }
})();
