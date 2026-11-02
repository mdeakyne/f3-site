import { PUBLIC_AO_CATALOG } from './q-catalog.ts';
import { eligiblePax, validSlot } from './q-dates.ts';
import { calendarSlots, refreshCalendar } from './q-calendar-controller.ts';
import { selectTurnstileSiteKey } from './contact-form-controller.ts';
import type { Pax, PublicClaim } from './q-types.ts';

type ChallengeOptions = { sitekey: string; action: string; callback: (token: string) => void; 'expired-callback': () => void; 'error-callback': () => void };
type ChallengeApi = { render: (element: HTMLElement, options: ChallengeOptions) => string; reset: (id: string) => void };

export function initQForm(root: Document, fetcher: typeof fetch, now: Date): void {
  const form = root.getElementById('q-form') as HTMLFormElement | null;
  const win = root.defaultView;
  if (!form || !win) return;
  const field = (name: string) => form.querySelector(`[name="${name}"]`) as HTMLInputElement;
  const ao = field('ao_slug');
  const date = field('event_date') as unknown as HTMLSelectElement;
  const search = root.getElementById('q-search') as HTMLInputElement;
  const options = root.getElementById('q-options')!;
  const other = field('f3_name_other');
  const submit = root.getElementById('q-submit') as HTMLButtonElement;
  const status = root.getElementById('form-status')!;
  const challengeStatus = root.getElementById('turnstile-status')!;
  const checklist = root.getElementById('q-checklist')!;
  const params = new URLSearchParams(win.location.search);
  const embedded = JSON.parse(root.getElementById('q-data')?.textContent || '{"pax":[]}');
  const pax: Pax[] = eligiblePax(embedded.pax, now);
  const names = [...pax, { slug: '__other__', name: 'Other / not listed', latest: null }];
  let claims: PublicClaim[] = [];
  let available = false;
  let sending = false;
  let completed = false;
  let token = '';
  let widgetId: string | null = null;
  let active = -1;
  let matches = names;
  const api = () => (win as unknown as { turnstile?: ChallengeApi }).turnstile;
  const setDisabled = () => { submit.disabled = !available || !token || sending || completed; };
  const setChallenge = (next: string, message: string) => {
    token = next.trim(); field('cf-turnstile-response').value = token;
    challengeStatus.textContent = message; setDisabled();
  };
  const close = () => { options.hidden = true; search.setAttribute('aria-expanded', 'false'); search.removeAttribute('aria-activedescendant'); active = -1; };
  const choose = (index: number) => {
    const choice = matches[index];
    if (!choice) return;
    field('q_slug').value = choice.slug;
    search.value = choice.name;
    other.hidden = choice.slug !== '__other__';
    other.required = !other.hidden;
    if (other.hidden) other.value = '';
    close();
  };
  const paintOptions = () => {
    options.replaceChildren();
    matches.forEach((choice, index) => {
      const option = root.createElement('li');
      option.id = `q-option-${index}`;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', String(index === active));
      option.className = `cursor-pointer px-3 py-2 ${index === active ? 'bg-surface-muted font-semibold' : ''}`;
      option.textContent = choice.name;
      option.addEventListener('mousedown', event => event.preventDefault());
      option.addEventListener('click', () => choose(index));
      options.appendChild(option);
    });
    options.hidden = false; search.setAttribute('aria-expanded', 'true');
    if (active >= 0) search.setAttribute('aria-activedescendant', `q-option-${active}`);
    else search.removeAttribute('aria-activedescendant');
  };
  search.addEventListener('focus', () => { matches = names; active = -1; paintOptions(); });
  search.addEventListener('input', () => {
    field('q_slug').value = ''; other.hidden = true; other.required = false;
    matches = names.filter(p => p.name.toLocaleLowerCase().includes(search.value.toLocaleLowerCase()));
    active = -1; paintOptions();
  });
  search.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (matches.length) active = active < 0
        ? (event.key === 'ArrowDown' ? 0 : matches.length - 1)
        : (active + (event.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length;
      paintOptions();
    }
    if (event.key === 'Enter' && !options.hidden) { event.preventDefault(); choose(active); }
  });
  search.addEventListener('blur', close);
  close(); other.hidden = true; other.required = false;

  function populateDates(selected = date.value) {
    date.replaceChildren();
    const placeholder = root.createElement('option');
    placeholder.value = ''; placeholder.textContent = available ? 'Choose a workout date' : 'Availability not confirmed';
    date.appendChild(placeholder);
    date.disabled = !available;
    field('time').value = PUBLIC_AO_CATALOG.find(item => item.slug === ao.value)?.time || '';
    if (!available) return;
    for (const slot of calendarSlots(now).filter(slot => slot.ao_slug === ao.value && !claims.some(c => c.ao_slug === slot.ao_slug && c.event_date === slot.event_date))) {
      const option = root.createElement('option'); option.value = slot.event_date; option.textContent = slot.event_date;
      date.appendChild(option);
    }
    if (Array.from(date.options).some(option => option.value === selected)) date.value = selected;
  }
  async function refresh(selected?: string) {
    available = false; populateDates(); setDisabled();
    try { claims = await refreshCalendar(root, fetcher, now); available = true; populateDates(selected); }
    catch { claims = []; populateDates(); }
    setDisabled();
  }
  ao.addEventListener('change', () => populateDates(''));
  if (PUBLIC_AO_CATALOG.some(item => item.slug === params.get('ao'))) ao.value = params.get('ao')!;
  field('loaded_at').value = String(Date.now());
  setDisabled();
  void refresh(params.get('date') || '');

  const expired = () => setChallenge('', 'Verification expired. Please complete it again.');
  const failed = () => setChallenge('', 'Verification could not complete. Please reload to try again.');
  const renderWidget = () => {
    if (widgetId !== null) return;
    if (!api()) { failed(); return; }
    try {
      widgetId = api()!.render(root.getElementById('turnstile-widget')!, {
        sitekey: selectTurnstileSiteKey(win.location.hostname, '0x4AAAAAAFFQOtzOy0HjVVtg', '1x00000000000000000000AA'),
        action: 'q_signup', callback: value => setChallenge(value, 'Verification complete.'),
        'expired-callback': expired, 'error-callback': failed,
      });
    } catch { failed(); }
  };
  if (api()) renderWidget();
  else {
    let script = root.getElementById('turnstile-api') as HTMLScriptElement | null;
    if (!script) {
      script = root.createElement('script'); script.id = 'turnstile-api';
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; script.async = true; script.defer = true;
      root.head.appendChild(script);
    }
    script.addEventListener('load', renderWidget, { once: true });
    script.addEventListener('error', failed, { once: true });
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!available || !token || sending || completed) return;
    const q = field('q_slug').value;
    if (!validSlot(ao.value, date.value, now) || claims.some(c => c.ao_slug === ao.value && c.event_date === date.value) ||
      !names.some(p => p.slug === q) || (q === '__other__' && !other.value.trim()) ||
      !field('title').value.trim() || !field('description').value.trim() || !['yes', 'no'].includes(field('coupon').value)) {
      status.textContent = 'Complete all required fields, including a listed Q or Other and Coupon Yes/No.'; return;
    }
    const data = new FormData();
    for (const name of ['ao_slug', 'event_date', 'q_slug', 'f3_name_other', 'title', 'description', 'coupon', 'cf-turnstile-response', 'company', 'loaded_at']) data.set(name, field(name).value);
    sending = true; setDisabled(); status.textContent = 'Claiming your workout …';
    try {
      const response = await fetcher('/api/q-signup', { method: 'POST', body: data });
      const payload = await response.json();
      if (response.ok && payload.ok === true) {
        completed = true; checklist.hidden = false;
        status.textContent = typeof payload.message === 'string' ? payload.message : 'Your workout is claimed.';
        await refresh('');
      } else {
        status.textContent = typeof payload.error === 'string' ? payload.error : 'Submission failed. Please try again.';
        if (response.status === 409) await refresh('');
      }
    } catch { status.textContent = 'Submission could not be confirmed. Refresh availability before trying again.'; await refresh(''); }
    finally {
      sending = false; setChallenge('', completed ? 'Your workout is claimed.' : 'Please complete a fresh verification before submitting again.');
      if (widgetId !== null) api()?.reset(widgetId);
      setDisabled();
    }
  });
}
