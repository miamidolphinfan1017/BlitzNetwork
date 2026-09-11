/* Blitz Network — Shared Auth & Nav Module
   Loaded on every page. Manages session, profile, avatar, and nav state. */
(function () {
  'use strict';

  var BlitzAuth = {};

  // ── Session ──
  BlitzAuth.getUser = function () {
    return localStorage.getItem('currentUser') || sessionStorage.getItem('currentUser');
  };
  BlitzAuth.setUser = function (username, remember) {
    if (remember) {
      localStorage.setItem('currentUser', username);
      sessionStorage.removeItem('currentUser');
    } else {
      sessionStorage.setItem('currentUser', username);
      localStorage.removeItem('currentUser');
    }
  };
  BlitzAuth.logout = function () {
    localStorage.removeItem('currentUser');
    sessionStorage.removeItem('currentUser');
  };

  // ── Registered users ──
  BlitzAuth.getRegisteredUsers = function () {
    try { return JSON.parse(localStorage.getItem('registeredUsers') || '{}'); }
    catch (e) { return {}; }
  };
  BlitzAuth.saveRegisteredUsers = function (users) {
    localStorage.setItem('registeredUsers', JSON.stringify(users));
  };

  // ── Profile ──
  BlitzAuth.getProfile = function (user) {
    if (!user) return {};
    try { return JSON.parse(localStorage.getItem('profile_' + user) || '{}'); }
    catch (e) { return {}; }
  };
  BlitzAuth.saveProfile = function (user, profile) {
    if (!user) return;
    localStorage.setItem('profile_' + user, JSON.stringify(profile || {}));
  };
  BlitzAuth.getDisplayName = function (user) {
    var p = BlitzAuth.getProfile(user);
    return p.displayName || user || '';
  };
  BlitzAuth.getAvatar = function (user) {
    if (!user) return '';
    var p = BlitzAuth.getProfile(user);
    return p.avatar || '';
  };
  BlitzAuth.getInitials = function (user) {
    var name = BlitzAuth.getDisplayName(user);
    return name.substring(0, 2).toUpperCase();
  };
  BlitzAuth.getFavoriteTeam = function (user) {
    if (!user) return '';
    var p = BlitzAuth.getProfile(user);
    return p.favoriteTeam || localStorage.getItem('favoriteTeam_' + user) || '';
  };

  // ── Image helper: resize + crop to square ──
  BlitzAuth.resizeAvatar = function (file, maxDim, quality, cb) {
    var reader = new FileReader();
    reader.onload = function (e) {
      var img = new Image();
      img.onload = function () {
        var w = img.width, h = img.height;
        var srcSize = Math.min(w, h);
        var sx = (w - srcSize) / 2, sy = (h - srcSize) / 2;
        var canvas = document.createElement('canvas');
        canvas.width = maxDim;
        canvas.height = maxDim;
        canvas.getContext('2d').drawImage(img, sx, sy, srcSize, srcSize, 0, 0, maxDim, maxDim);
        cb(canvas.toDataURL('image/jpeg', quality || 0.85));
      };
      img.onerror = function () { cb(null); };
      img.src = e.target.result;
    };
    reader.onerror = function () { cb(null); };
    reader.readAsDataURL(file);
  };

  // ── Nav update (runs on every page) ──
  BlitzAuth.updateNav = function () {
    var user = BlitzAuth.getUser();
    var navBtn = document.getElementById('nav-login-btn');
    var sideLink = document.getElementById('side-login-link');

    if (user && navBtn && !navBtn.classList.contains('nav-account-link')) {
      var profile = BlitzAuth.getProfile(user);
      var displayName = profile.displayName || user;
      var avatar = profile.avatar || '';

      var link = document.createElement('a');
      link.href = 'Account.html';
      link.className = 'nav-account-link';
      link.id = 'nav-login-btn';

      var avatarEl = document.createElement('span');
      avatarEl.className = 'nav-avatar';
      if (avatar) {
        var img = document.createElement('img');
        img.src = avatar;
        img.alt = displayName;
        img.className = 'nav-avatar-img';
        avatarEl.appendChild(img);
      } else {
        avatarEl.textContent = displayName.substring(0, 2).toUpperCase();
      }
      link.appendChild(avatarEl);

      var nameEl = document.createElement('span');
      nameEl.className = 'nav-username';
      nameEl.textContent = displayName;
      link.appendChild(nameEl);

      navBtn.parentNode.replaceChild(link, navBtn);
    }

    if (user && sideLink) {
      sideLink.innerText = 'Account';
      sideLink.href = 'Account.html';
    }
  };

  // ── Username change with full data migration ──
  BlitzAuth.changeUsername = function (oldName, newName) {
    if (!oldName || !newName || oldName === newName)
      return { success: false, error: 'Invalid username' };
    if (!/^[a-zA-Z0-9_]{2,20}$/.test(newName))
      return { success: false, error: 'Username must be 2–20 letters, numbers, or underscores' };

    var users = BlitzAuth.getRegisteredUsers();
    if (users[newName])
      return { success: false, error: 'That username is already taken' };

    // Migrate user record
    if (users[oldName]) {
      users[newName] = users[oldName];
      delete users[oldName];
      BlitzAuth.saveRegisteredUsers(users);
    }

    // Migrate profile
    var profile = BlitzAuth.getProfile(oldName);
    if (Object.keys(profile).length) {
      BlitzAuth.saveProfile(newName, profile);
      localStorage.removeItem('profile_' + oldName);
    }

    // Migrate keys with user suffix
    ['favoriteTeam_', 'favoriteTeamId_', 'BestScore_'].forEach(function (prefix) {
      var val = localStorage.getItem(prefix + oldName);
      if (val !== null) {
        localStorage.setItem(prefix + newName, val);
        localStorage.removeItem(prefix + oldName);
      }
    });

    // Update session
    var wasLocal = localStorage.getItem('currentUser') === oldName;
    if (wasLocal) localStorage.setItem('currentUser', newName);
    else sessionStorage.setItem('currentUser', newName);

    return { success: true };
  };

  // ── Google Sign-In ──
  BlitzAuth.handleGoogleCredential = function (response) {
    try {
      var payload = JSON.parse(atob(response.credential.split('.')[1]));
      var email = payload.email;
      var name = payload.name;
      var picture = payload.picture;
      var googleSub = payload.sub;

      var users = BlitzAuth.getRegisteredUsers();
      var existing = Object.keys(users).find(function (k) {
        return (users[k].email || '').toLowerCase() === email.toLowerCase() ||
               users[k].googleSub === googleSub;
      });

      var username;
      if (existing) {
        username = existing;
        var prof = BlitzAuth.getProfile(username);
        if (!prof.avatar && picture) prof.avatar = picture;
        if (name && !prof.displayName) prof.displayName = name;
        prof.googleAvatar = picture;
        BlitzAuth.saveProfile(username, prof);
      } else {
        username = (name || email.split('@')[0]).replace(/[^a-zA-Z0-9]/g, '');
        var base = username, i = 1;
        while (users[username]) { username = base + i; i++; }
        users[username] = { password: '', email: email, created: Date.now(), google: true, googleSub: googleSub };
        BlitzAuth.saveRegisteredUsers(users);
        BlitzAuth.saveProfile(username, { displayName: name || username, avatar: picture || '', googleAvatar: picture });
      }

      BlitzAuth.setUser(username, true);
      var dest = localStorage.getItem('redirectAfterLogin') || 'index.html';
      localStorage.removeItem('redirectAfterLogin');
      window.location.href = dest;
    } catch (e) {
      console.error('Google sign-in error:', e);
    }
  };

  BlitzAuth.initGoogleSignIn = function (containerId) {
    var config = window.BLITZ_AUTH_CONFIG || {};
    if (!config.googleClientId || typeof google === 'undefined') return false;
    google.accounts.id.initialize({
      client_id: config.googleClientId,
      callback: BlitzAuth.handleGoogleCredential
    });
    if (containerId) {
      var c = document.getElementById(containerId);
      if (c) google.accounts.id.renderButton(c, { type: 'standard', theme: 'outline', size: 'large', width: 320, text: 'continue_with' });
    }
    return true;
  };

  // ── Boot ──
  function boot() { setTimeout(BlitzAuth.updateNav, 0); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.addEventListener('storage', function (e) {
    if (e.key === 'currentUser' || e.key === null) boot();
  });

  window.BlitzAuth = BlitzAuth;
})();
