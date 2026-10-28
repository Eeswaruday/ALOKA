(() => {
  const publishableKey = window.ALOKA_CLERK_PUBLISHABLE_KEY?.trim();
  const status = document.querySelector('#auth-status');
  const buttons = ['#nav-signin', '#signin', '#signup'].map(selector => document.querySelector(selector));
  let userButtonMounted = false;
  let clerkDomain = '';
  let clerkPromise;

  function setSignedIn(user) {
    const signedIn = Boolean(user);
    buttons.forEach(button => { if (button) button.hidden = signedIn; });
    const mount = document.querySelector('#clerk-user-button');
    if (!mount) return;
    if (signedIn && !userButtonMounted) {
      mount.hidden = false;
      window.Clerk.mountUserButton(mount);
      userButtonMounted = true;
    } else if (!signedIn && userButtonMounted) {
      window.Clerk.unmountUserButton(mount);
      mount.replaceChildren();
      mount.hidden = true;
      userButtonMounted = false;
    }
    if (status) status.textContent = signedIn ? 'Signed in with Clerk.' : 'Browse public learning resources as a guest.';
  }

  function loadScript(src, key) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      if (key) script.dataset.clerkPublishableKey = key;
      script.crossOrigin = 'anonymous';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Clerk could not be loaded. Check your network and Clerk domain settings.'));
      document.head.append(script);
    });
  }

  async function openAuth(kind) {
    if (!publishableKey || !clerkDomain) {
      if (status) status.textContent = publishableKey ? 'Clerk sign-in requires HTTPS and a valid configuration.' : 'Add your Clerk publishable key in js/clerk-config.js to enable sign-in.';
      return;
    }
    try {
      if (!window.Clerk) {
        clerkPromise ||= (async () => {
          await loadScript(`https://${clerkDomain}/npm/@clerk/ui@1/dist/ui.browser.js`);
          await loadScript(`https://${clerkDomain}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`, publishableKey);
          await window.Clerk.load({ ui: { ClerkUI: window.__internal_ClerkUICtor } });
          window.Clerk.addListener(({ user }) => { if (user !== undefined) setSignedIn(user); });
        })().catch(error => { clerkPromise = undefined; throw error; });
        await clerkPromise;
      }
      await window.Clerk[kind]();
    } catch {
      if (status) status.textContent = 'Clerk sign-in could not open. Check the Clerk dashboard configuration.';
    }
  }

  document.querySelector('#nav-signin')?.addEventListener('click', () => openAuth('openSignIn'));
  document.querySelector('#signin')?.addEventListener('click', () => openAuth('openSignIn'));
  document.querySelector('#signup')?.addEventListener('click', () => openAuth('openSignUp'));

  if (!publishableKey) return;
  if (location.protocol === 'file:') {
    if (status) status.textContent = 'Clerk sign-in requires localhost or HTTPS; guest browsing works here.';
    return;
  }
  if (!/^pk_(test|live)_/.test(publishableKey)) {
    if (status) status.textContent = 'The Clerk publishable key format is invalid.';
    return;
  }

  const encodedDomain = publishableKey.split('_')[2];
  try {
    clerkDomain = atob(encodedDomain.replace(/-/g, '+').replace(/_/g, '/')).replace(/\$$/, '');
    if (!/^[a-z0-9.-]+$/i.test(clerkDomain)) throw new Error('Invalid domain');
  } catch {
    if (status) status.textContent = 'The Clerk publishable key could not be decoded.';
    return;
  }

})();

