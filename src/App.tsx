import React, { useState, useEffect, Component, ErrorInfo, ReactNode } from 'react';
import { auth, db, handleFirestoreError, OperationType } from './firebase';
import { onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile, signOut, User, setPersistence, browserLocalPersistence, browserSessionPersistence, sendPasswordResetEmail, confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth';
import { doc, getDoc, setDoc, onSnapshot, collection, query, where, orderBy, getDocFromServer, arrayUnion, deleteDoc, updateDoc, getDocs, writeBatch } from 'firebase/firestore';
import { UserProfile, Trip, Expense, Withdrawal, Invitation, Person } from './types';
import { Plus, List, CreditCard, PieChart, Settings as SettingsIcon, LogOut, Compass, Bell, Eye, EyeOff, Users } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { motion, AnimatePresence } from 'motion/react';

// Components
import ExpenseForm from './components/ExpenseForm';
import ExpenseList from './components/ExpenseList';
import WithdrawalList from './components/WithdrawalList';
import Summary from './components/Summary';
import GroupSection from './components/GroupSection';
import Settings from './components/Settings';
import { fetchExchangeRates } from './services/currencyService';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const DEFAULT_CATEGORIES = ['Jídlo', 'Doprava', 'Ubytování', 'Zábava', 'Nákupy', 'Ostatní'];

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [activeTripId, setActiveTripId] = useState<string | null>(() => {
    // Only return if it's a valid looking ID, otherwise null
    const saved = localStorage.getItem('activeTripId');
    return (saved && saved !== 'undefined' && saved !== 'null') ? saved : null;
  });
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [activeTab, setActiveTab] = useState<'add' | 'list' | 'withdrawals' | 'group' | 'summary' | 'settings'>('add');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<any>(null);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [exchangeRates, setExchangeRates] = useState<Record<string, number> | null>(() => {
    const saved = localStorage.getItem('cachedExchangeRates');
    return saved ? JSON.parse(saved) : null;
  });
  const [isLoadingRates, setIsLoadingRates] = useState(false);
  const [lastRatesUpdate, setLastRatesUpdate] = useState<string | null>(() => localStorage.getItem('lastRatesUpdate'));
  
  // Auth states
  const [isRegistering, setIsRegistering] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginName, setLoginName] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const loadRates = async () => {
    if (!profile?.baseCurrency) return;
    setIsLoadingRates(true);
    const rates = await fetchExchangeRates(profile.baseCurrency);
    if (rates) {
      setExchangeRates(rates);
      const now = new Date().toISOString();
      setLastRatesUpdate(now);
      localStorage.setItem('cachedExchangeRates', JSON.stringify(rates));
      localStorage.setItem('lastRatesUpdate', now);
    }
    setIsLoadingRates(false);
  };

  // Auto-refresh rates every 30 minutes
  useEffect(() => {
    if (!profile?.baseCurrency) return;
    
    loadRates();
    const interval = setInterval(loadRates, 30 * 60 * 1000); // 30 minutes
    
    return () => clearInterval(interval);
  }, [profile?.baseCurrency]);

  // Persist activeTripId to localStorage
  useEffect(() => {
    if (activeTripId) {
      localStorage.setItem('activeTripId', activeTripId);
    }
  }, [activeTripId]);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (loading && user) {
        console.warn("Loading timeout reached, forcing loading to false");
        setLoading(false);
      }
    }, 8000); // 8 seconds timeout
    return () => clearTimeout(timer);
  }, [loading, user]);

  useEffect(() => {
    if (error) return; // Don't run effects if there's a fatal error
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. ");
        }
      }
    }
    testConnection();

    let profileUnsub: (() => void) | null = null;

    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      // Clean up previous profile listener if it exists
      if (profileUnsub) {
        profileUnsub();
        profileUnsub = null;
      }

      setUser(u);
      if (u) {
        setLoading(true);
        const profileRef = doc(db, 'users', u.uid);
        
        // Initial check and creation if needed
        const creationPromise = (async () => {
          try {
            const snap = await getDoc(profileRef);
            if (!snap.exists()) {
              const baseName = u.displayName || 'Uživatel';
              let finalName = baseName;
              
              try {
                // Check if name is taken
                const nameQuery = query(collection(db, 'users'), where('displayName', '==', baseName));
                const nameSnap = await getDocs(nameQuery);
                if (!nameSnap.empty) {
                  finalName = `${baseName}_${Math.floor(Math.random() * 1000)}`;
                }
              } catch (nameErr) {
                console.warn("Name uniqueness check failed, using base name:", nameErr);
              }

              const newProfile: UserProfile = {
                uid: u.uid,
                email: u.email || '',
                displayName: finalName,
                photoURL: u.photoURL || '',
                categories: DEFAULT_CATEGORIES,
                paymentMethods: ['CASH', 'KARTA'],
                baseCurrency: 'CZK',
                stayLoggedIn: true
              };
              console.log("Creating new profile for user:", u.uid, newProfile);
              await setDoc(profileRef, newProfile);
              console.log("Profile created successfully");
            } else {
              console.log("Profile already exists for user:", u.uid);
            }
          } catch (err) {
            console.error("Error during initial profile check/creation:", err);
            // Only set error if it's a permission issue that blocks the app
            if (err instanceof Error && err.message.includes('permission')) {
              setError(err);
            }
            setLoading(false);
          }
        })();

        // Set up real-time listener
        profileUnsub = onSnapshot(profileRef, async (snap) => {
          if (snap.exists()) {
            const data = snap.data() as UserProfile;
            setProfile(data);
            
            // Set persistence based on profile
            try {
              await setPersistence(
                auth, 
                data.stayLoggedIn !== false ? browserLocalPersistence : browserSessionPersistence
              );
            } catch (pErr) {
              console.warn("Failed to set persistence:", pErr);
            }
            setLoading(false);
          } else {
            console.warn("Profile document still does not exist in snapshot");
            // If it still doesn't exist after the creation promise finished, something is wrong
            creationPromise.then(() => {
              getDoc(profileRef).then(s => {
                if (!s.exists()) {
                  console.error("Profile still missing after creation attempt");
                  setLoading(false);
                }
              });
            });
          }
        }, (err) => {
          handleFirestoreError(err, OperationType.GET, `users/${u.uid}`);
          setLoading(false);
        });
      } else {
        setProfile(null);
        setTrips([]);
        setActiveTripId(null);
        setLoading(false);
      }
    });

    return () => {
      unsubscribe();
      if (profileUnsub) profileUnsub();
    };
  }, [error]);

  useEffect(() => {
    if (!user) return;
    
    // Fetch trips where user is owner
    const qOwner = query(collection(db, 'trips'), where('ownerId', '==', user.uid), orderBy('startDate', 'desc'));
    const unsubOwner = onSnapshot(qOwner, (snap) => {
      const ownerTrips = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Trip));
      setTrips(prev => {
        const otherTrips = prev.filter(t => t.ownerId !== user.uid);
        const combined = [...ownerTrips, ...otherTrips].sort((a, b) => 
          new Date(b.startDate).getTime() - new Date(a.startDate).getTime()
        );
        return combined;
      });
      
      // If no active trip is selected or the saved one doesn't exist yet, 
      // we'll wait for both owner and collab trips to load before deciding.
    });

    // Fetch trips where user is collaborator
    const qCollab = query(collection(db, 'trips'), where('collaborators', 'array-contains', user.uid), orderBy('startDate', 'desc'));
    const unsubCollab = onSnapshot(qCollab, (snap) => {
      const collabTrips = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Trip));
      setTrips(prev => {
        const otherTrips = prev.filter(t => t.ownerId === user.uid);
        const combined = [...otherTrips, ...collabTrips].sort((a, b) => 
          new Date(b.startDate).getTime() - new Date(a.startDate).getTime()
        );
        return combined;
      });
    });

    // Fetch invitations
    const qInvitesId = query(collection(db, 'invitations'), where('inviteeId', '==', user.uid), where('status', '==', 'pending'));
    const qInvitesEmail = query(collection(db, 'invitations'), where('inviteeEmail', '==', user.email?.toLowerCase() || ''), where('status', '==', 'pending'));
    
    let idInvites: Invitation[] = [];
    let emailInvites: Invitation[] = [];

    const updateInvites = () => {
      const combined = [...idInvites, ...emailInvites];
      const unique = combined.filter((v, i, a) => a.findIndex(t => t.id === v.id) === i);
      setInvitations(unique);
    };

    const unsubInvitesId = onSnapshot(qInvitesId, (snap) => {
      idInvites = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Invitation));
      updateInvites();
    });

    const unsubInvitesEmail = onSnapshot(qInvitesEmail, (snap) => {
      emailInvites = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Invitation));
      updateInvites();
    });

    // Fetch people
    const qPeople = query(collection(db, 'people'), where('ownerId', '==', user.uid));
    const unsubPeople = onSnapshot(qPeople, (snap) => {
      const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Person));
      setPeople(list);
    }, (err) => {
      console.error("Failed to load people in App.tsx:", err);
    });

    return () => {
      unsubOwner();
      unsubCollab();
      unsubInvitesId();
      unsubInvitesEmail();
      unsubPeople();
    };
  }, [user]);

  // Handle initial active trip selection once trips are loaded
  useEffect(() => {
    if (trips.length > 0) {
      const savedId = localStorage.getItem('activeTripId');
      const found = trips.find(t => t.id === savedId);
      
      if (found) {
        if (activeTripId !== savedId) setActiveTripId(savedId);
      } else if (!activeTripId || !trips.find(t => t.id === activeTripId)) {
        // If current activeTripId is not in the list, pick the first active (unarchived) trip
        const firstActive = trips.find(t => !t.archived);
        setActiveTripId(firstActive ? firstActive.id : trips[0].id);
      }
    } else if (!loading && trips.length === 0) {
      // If we finished loading and there are no trips, clear active ID
      setActiveTripId(null);
      localStorage.removeItem('activeTripId');
    }
  }, [trips, loading]);

  useEffect(() => {
    if (!activeTripId || !user) {
      setExpenses([]);
      setWithdrawals([]);
      return;
    }

    // Verify user actually has access to this trip in local state before querying
    // This prevents "Missing or insufficient permissions" errors from old localStorage IDs
    const hasAccess = trips.some(t => t.id === activeTripId);
    if (!hasAccess && trips.length > 0) {
      return;
    }

    const expQ = query(
      collection(db, 'expenses'), 
      where('tripId', '==', activeTripId), 
      orderBy('date', 'desc')
    );
    const expUnsub = onSnapshot(expQ, { includeMetadataChanges: true }, (snap) => {
      setExpenses(snap.docs.map(doc => ({ id: doc.id, ...doc.data(), _hasPendingWrites: doc.metadata.hasPendingWrites } as any)));
    }, (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'expenses');
      } catch (e) {
        setError(e);
      }
    });

    const withQ = query(
      collection(db, 'withdrawals'), 
      where('tripId', '==', activeTripId), 
      orderBy('date', 'desc')
    );
    const withUnsub = onSnapshot(withQ, { includeMetadataChanges: true }, (snap) => {
      setWithdrawals(snap.docs.map(doc => ({ id: doc.id, ...doc.data(), _hasPendingWrites: doc.metadata.hasPendingWrites } as any)));
    }, (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'withdrawals');
      } catch (e) {
        setError(e);
      }
    });

    return () => {
      expUnsub();
      withUnsub();
    };
  }, [activeTripId, user]);

  const handleAcceptInvitation = async (invite: Invitation) => {
    try {
      const batch = writeBatch(db);
      
      // 1. Add user to trip collaborators
      batch.update(doc(db, 'trips', invite.tripId), {
        collaborators: arrayUnion(user!.uid)
      });
      
      // 2. Delete the invitation (makes the link single-use)
      batch.delete(doc(db, 'invitations', invite.id));
      
      await batch.commit();
      
      // 3. Notify inviter via email
      if (invite.inviterEmail) {
        fetch('/api/send-invite-accepted', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            inviterEmail: invite.inviterEmail,
            inviterName: invite.inviterName,
            inviteeName: profile?.displayName || user?.email || 'Někdo',
            tripName: invite.tripName
          })
        }).catch(err => console.error('Failed to notify inviter:', err));
      }
      
      // Switch to the accepted trip
      setActiveTripId(invite.tripId);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `trips/${invite.tripId}`);
    }
  };

  const handleDeclineInvitation = async (invite: Invitation) => {
    try {
      await deleteDoc(doc(db, 'invitations', invite.id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `invitations/${invite.id}`);
    }
  };

  useEffect(() => {
    const applyTheme = () => {
      if (!profile?.theme || profile.theme === 'default') {
        document.documentElement.removeAttribute('data-theme');
        return;
      }

      if (profile.theme === 'system') {
        const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'default');
      } else {
        document.documentElement.setAttribute('data-theme', profile.theme);
      }
    };

    applyTheme();

    // Listen for system theme changes if 'system' is selected
    if (profile?.theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const listener = () => applyTheme();
      mediaQuery.addEventListener('change', listener);
      return () => mediaQuery.removeEventListener('change', listener);
    }
  }, [profile?.theme]);

  useEffect(() => {
    if (activeTab === 'group' && profile?.showGroupSection === false) {
      setActiveTab('add');
    }
  }, [activeTab, profile?.showGroupSection]);

  const activeTrip = trips.find(t => t.id === activeTripId);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const inviteId = params.get('invite');
    if (inviteId && user) {
      setActiveTab('settings');
      // Clear the param from URL without reload
      const newUrl = window.location.origin + window.location.pathname;
      window.history.replaceState({}, '', newUrl);
    }
  }, [user]);

  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  
  // In-app password reset (handling link from email)
  const [resetCode, setResetCode] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [isSettingNewPassword, setIsSettingNewPassword] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oobCode = params.get('oobCode');
    const mode = params.get('mode');

    if (oobCode && mode === 'resetPassword') {
      setResetCode(oobCode);
      setIsSettingNewPassword(true);
    }
  }, []);

  const handleConfirmNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmNewPassword) {
      setAuthError('Hesla se neshodují.');
      return;
    }
    if (newPassword.length < 6) {
      setAuthError('Heslo musí mít alespoň 6 znaků.');
      return;
    }
    if (!resetCode) return;

    setAuthLoading(true);
    setAuthError(null);
    try {
      await confirmPasswordReset(auth, resetCode, newPassword);
      setResetSuccess(true);
      // Clear URL params
      window.history.replaceState({}, document.title, window.location.pathname);
    } catch (error: any) {
      console.error('Confirm password reset failed', error);
      setAuthError('Odkaz pro resetování hesla je neplatný nebo vypršel.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginEmail) {
      setAuthError('Zadejte prosím svůj e-mail.');
      return;
    }
    setAuthLoading(true);
    setAuthError(null);
    try {
      // Configuration to redirect back to the app after reset
      const actionCodeSettings = {
        url: window.location.origin,
        handleCodeInApp: true,
      };
      await sendPasswordResetEmail(auth, loginEmail, actionCodeSettings);
      setResetSuccess(true);
    } catch (error: any) {
      console.error('Reset password failed', error);
      let msg = 'Chyba při odesílání e-mailu pro reset hesla.';
      if (error.code === 'auth/user-not-found') {
        msg = 'Uživatel s tímto e-mailem nebyl nalezen.';
      } else if (error.code === 'auth/invalid-email') {
        msg = 'Neplatný formát e-mailu.';
      }
      setAuthError(msg);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError(null);
    try {
      if (isRegistering) {
        const userCredential = await createUserWithEmailAndPassword(auth, loginEmail, loginPassword);
        if (loginName) {
          await updateProfile(userCredential.user, { displayName: loginName });
        }
      } else {
        await signInWithEmailAndPassword(auth, loginEmail, loginPassword);
      }
    } catch (error: any) {
      console.error('Email auth failed', error);
      let msg = 'Chyba při přihlašování.';
      if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
        msg = 'Nesprávný e-mail nebo heslo.';
      } else if (error.code === 'auth/email-already-in-use') {
        msg = 'Tento e-mail již používá jiný účet.';
      } else if (error.code === 'auth/weak-password') {
        msg = 'Heslo musí mít alespoň 6 znaků.';
      } else if (error.code === 'auth/invalid-email') {
        msg = 'Neplatný formát e-mailu.';
      }
      setAuthError(msg);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => signOut(auth);

  if (loading || (user && !profile)) {
    return (
      <div className="min-h-screen bg-bg-soft flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-bg-soft flex flex-col items-center justify-center p-6 bg-gradient-to-br from-bg-soft to-white">
        <div className="bg-white p-8 rounded-[40px] shadow-xl max-w-md w-full text-center border border-border-subtle animate-in fade-in zoom-in duration-500">
          <div className="mb-8">
            <div className="bg-primary/5 w-20 h-20 rounded-[24px] flex items-center justify-center mx-auto mb-4">
              <Compass className="w-12 h-12 text-primary" />
            </div>
            <h1 className="text-4xl font-serif mb-2 text-primary font-bold">TripSpend</h1>
            <p className="text-text-muted text-sm px-4">Vaše finance na cestách pod kontrolou.</p>
          </div>

          {authError && (
            <div className="mb-6 p-4 bg-red-50 text-red-600 rounded-2xl text-xs font-bold uppercase tracking-wider">
              {authError}
            </div>
          )}

          {isSettingNewPassword ? (
            <form onSubmit={handleConfirmNewPassword} className="space-y-4">
              <div className="text-center mb-6">
                <h2 className="font-serif text-2xl font-bold text-primary mb-2">Nové heslo</h2>
                <p className="text-sm text-text-muted">Nastavte si nové silné heslo.</p>
              </div>

              {resetSuccess ? (
                <div className="p-4 bg-green-50 text-green-700 text-sm rounded-2xl border border-green-100 text-center">
                  Heslo bylo úspěšně změněno. Nyní se můžete přihlásit.
                  <button 
                    type="button"
                    onClick={() => {
                      setIsSettingNewPassword(false);
                      setResetSuccess(false);
                      setIsRegistering(false);
                    }}
                    className="block w-full mt-4 font-bold text-primary hover:underline"
                  >
                    Zpět na přihlášení
                  </button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      placeholder="Nové heslo"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full bg-bg-soft rounded-2xl p-4 pr-12 focus:ring-2 focus:ring-primary outline-none transition-all text-sm font-medium"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-text-muted hover:text-primary"
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      placeholder="Potvrzení hesla"
                      value={confirmNewPassword}
                      onChange={(e) => setConfirmNewPassword(e.target.value)}
                      className="w-full bg-bg-soft rounded-2xl p-4 pr-12 focus:ring-2 focus:ring-primary outline-none transition-all text-sm font-medium"
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={authLoading}
                    className="w-full bg-primary text-white py-4 rounded-2xl font-bold hover:bg-primary-dark transition-all flex items-center justify-center gap-2 shadow-lg active:scale-[0.98] disabled:opacity-50 disabled:scale-100"
                  >
                    {authLoading ? (
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : 'Uložit nové heslo'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsSettingNewPassword(false);
                      setAuthError(null);
                    }}
                    className="w-full text-xs text-text-muted font-bold uppercase tracking-widest hover:text-primary transition-colors text-center"
                  >
                    Zrušit
                  </button>
                </>
              )}
            </form>
          ) : isResettingPassword ? (
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div className="text-center mb-6">
                <p className="text-sm text-text-muted">Zadejte svůj e-mail a my vám pošleme odkaz pro obnovení hesla.</p>
              </div>

              {resetSuccess ? (
                <div className="p-4 bg-green-50 text-green-700 text-sm rounded-2xl border border-green-100 text-center">
                  Odkaz pro obnovení hesla byl odeslán na váš e-mail.
                  <button 
                    type="button"
                    onClick={() => {
                      setIsResettingPassword(false);
                      setResetSuccess(false);
                    }}
                    className="block w-full mt-4 font-bold text-primary hover:underline"
                  >
                    Zpět na přihlášení
                  </button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <input
                      type="email"
                      placeholder="E-mail"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      className="w-full bg-bg-soft rounded-2xl p-4 focus:ring-2 focus:ring-primary outline-none transition-all text-sm font-medium"
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={authLoading}
                    className="w-full bg-primary text-white py-4 rounded-2xl font-bold hover:bg-primary-dark transition-all flex items-center justify-center gap-2 shadow-lg active:scale-[0.98] disabled:opacity-50 disabled:scale-100"
                  >
                    {authLoading ? (
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : 'Odeslat odkaz'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsResettingPassword(false);
                      setAuthError(null);
                    }}
                    className="w-full text-xs text-text-muted font-bold uppercase tracking-widest hover:text-primary transition-colors text-center"
                  >
                    Zpět na přihlášení
                  </button>
                </>
              )}
            </form>
          ) : (
            <form onSubmit={handleEmailAuth} className="space-y-4">
              {isRegistering && (
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Vaše jméno"
                    value={loginName}
                    onChange={(e) => setLoginName(e.target.value)}
                    className="w-full bg-bg-soft rounded-2xl p-4 focus:ring-2 focus:ring-primary outline-none transition-all text-sm font-medium"
                    required={isRegistering}
                  />
                </div>
              )}
              <div className="relative">
                <input
                  type="email"
                  placeholder="E-mail"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  className="w-full bg-bg-soft rounded-2xl p-4 focus:ring-2 focus:ring-primary outline-none transition-all text-sm font-medium"
                  required
                />
              </div>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Heslo"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  className="w-full bg-bg-soft rounded-2xl p-4 pr-12 focus:ring-2 focus:ring-primary outline-none transition-all text-sm font-medium"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-text-muted hover:text-primary"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>

              {!isRegistering && (
                <div className="flex justify-end px-2">
                  <button 
                    type="button"
                    onClick={() => {
                      setIsResettingPassword(true);
                      setAuthError(null);
                    }}
                    className="text-[10px] font-bold uppercase tracking-widest text-text-muted hover:text-primary transition-colors"
                  >
                    Zapomenuté heslo?
                  </button>
                </div>
              )}

              <button
                type="submit"
                disabled={authLoading}
                className="w-full bg-primary text-white py-4 rounded-2xl font-bold hover:bg-primary-dark transition-all flex items-center justify-center gap-2 shadow-lg active:scale-[0.98] disabled:opacity-50 disabled:scale-100"
              >
                {authLoading ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : isRegistering ? 'Vytvořit účet' : 'Přihlásit se'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsRegistering(!isRegistering);
                  setAuthError(null);
                }}
                className="w-full text-xs text-text-muted font-bold uppercase tracking-widest hover:text-primary transition-colors text-center"
              >
                {isRegistering ? 'Již máte účet? Přihlásit se' : 'Nemáte účet? Registrovat se'}
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  if (error) {
    let errorMessage = "Něco se pokazilo.";
    try {
      const parsed = JSON.parse(error.message);
      if (parsed.error && parsed.operationType) {
        errorMessage = `Chyba při operaci ${parsed.operationType} na cestě ${parsed.path}: ${parsed.error}`;
      }
    } catch (e) {
      errorMessage = error.message || errorMessage;
    }

    return (
      <div className="min-h-screen bg-bg-soft flex flex-col items-center justify-center p-6 text-center">
        <div className="bg-white p-8 rounded-[32px] shadow-sm max-w-md w-full">
          <h2 className="text-2xl font-serif mb-4 text-red-600">Ups! Došlo k chybě</h2>
          <p className="text-primary mb-6">{errorMessage}</p>
          <button
            onClick={() => window.location.reload()}
            className="w-full bg-primary text-primary-content py-3 rounded-full font-medium shadow-md active:scale-[0.98]"
          >
            Zkusit znovu
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-soft pb-24 flex flex-col overflow-x-hidden">
        {/* Header */}
        <header className="bg-white px-4 py-4 shadow-sm sticky top-0 z-20">
          <div className="max-w-xl mx-auto flex items-center justify-between">
            <div className="flex-1 min-w-0 mr-4">
              <div className="flex items-center gap-2">
                <Compass className="w-5 h-5 text-primary" />
                <h1 className="text-xl font-serif text-primary truncate">TripSpend</h1>
                {isOffline && (
                  <span className="bg-amber-100 text-amber-700 text-[8px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-tighter">Offline</span>
                )}
              </div>
              {activeTrip && (
                <p className="text-[10px] text-primary font-bold uppercase tracking-widest truncate">
                  {activeTrip.name} ({activeTrip.currency})
                </p>
              )}
            </div>
            <div className="flex-shrink-0">
              <select
                value={activeTripId || ''}
                onChange={(e) => setActiveTripId(e.target.value)}
                className="text-sm bg-bg-soft rounded-xl px-3 py-2 focus:ring-0 text-primary font-bold cursor-pointer max-w-[140px]"
              >
                {trips.length === 0 && <option value="">Žádné výlety</option>}
                {trips
                  .filter(t => !t.archived || t.id === activeTripId)
                  .map(t => (
                    <option key={t.id} value={t.id}>
                      {t.name}{t.archived ? ' (Archiv)' : ''}
                    </option>
                  ))}
              </select>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="max-w-xl mx-auto w-full p-4 flex-1">
          {!activeTrip && activeTab !== 'settings' ? (
            <div className="text-center py-12">
              <Compass className="w-12 h-12 mx-auto mb-4 text-primary opacity-20" />
              <p className="text-primary mb-4">Nejdříve si vytvořte výlet v nastavení.</p>
              <button
                onClick={() => setActiveTab('settings')}
                className="text-primary underline font-medium"
              >
                Přejít do nastavení
              </button>
            </div>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.2 }}
              >
                {activeTab === 'add' && activeTrip && profile && (
                  <ExpenseForm 
                    trip={activeTrip} 
                    profile={profile} 
                    withdrawals={withdrawals}
                    exchangeRates={exchangeRates}
                    isLoadingRates={isLoadingRates}
                    onRefreshRates={loadRates}
                    people={people}
                  />
                )}
                {activeTab === 'list' && activeTrip && profile && (
                  <ExpenseList 
                    expenses={expenses} 
                    trip={activeTrip} 
                    profile={profile} 
                    withdrawals={withdrawals}
                    exchangeRates={exchangeRates}
                    people={people}
                  />
                )}
                {activeTab === 'withdrawals' && activeTrip && profile && (
                  <WithdrawalList 
                    withdrawals={withdrawals} 
                    trip={activeTrip} 
                    profile={profile}
                    exchangeRates={exchangeRates}
                    isLoadingRates={isLoadingRates}
                    onRefreshRates={loadRates}
                  />
                )}
                {activeTab === 'summary' && activeTrip && profile && (
                  <Summary 
                    expenses={expenses} 
                    withdrawals={withdrawals} 
                    trip={activeTrip} 
                    profile={profile} 
                    allTrips={trips}
                    exchangeRates={exchangeRates}
                  />
                )}
                {activeTab === 'group' && activeTrip && profile && (
                  <GroupSection
                    expenses={expenses}
                    withdrawals={withdrawals}
                    trip={activeTrip}
                    profile={profile}
                    people={people}
                    exchangeRates={exchangeRates}
                  />
                )}
                {activeTab === 'settings' && profile && (
                  <Settings 
                    profile={profile} 
                    trips={trips} 
                    invitations={invitations}
                    onAcceptInvitation={handleAcceptInvitation}
                    onDeclineInvitation={handleDeclineInvitation}
                    onLogout={handleLogout}
                    exchangeRates={exchangeRates}
                    isLoadingRates={isLoadingRates}
                    lastRatesUpdate={lastRatesUpdate}
                    onRefreshRates={loadRates}
                    onSelectTrip={(tripId) => {
                      setActiveTripId(tripId);
                      setActiveTab('list');
                    }}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          )}
        </main>

        {/* Bottom Navigation */}
        <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-bg-soft px-4 pt-3 pb-safe-offset-3 flex justify-between items-center z-20">
          <div className="max-w-xl mx-auto w-full flex justify-between items-center">
            <NavButton
              active={activeTab === 'add'}
              onClick={() => setActiveTab('add')}
              icon={<Plus size={24} />}
              label="Přidat"
            />
            <NavButton
              active={activeTab === 'list'}
              onClick={() => setActiveTab('list')}
              icon={<List size={24} />}
              label="Útraty"
            />
            <NavButton
              active={activeTab === 'withdrawals'}
              onClick={() => setActiveTab('withdrawals')}
              icon={<CreditCard size={24} />}
              label="Výběry"
            />
            {profile?.showGroupSection !== false && (
              <NavButton
                active={activeTab === 'group'}
                onClick={() => setActiveTab('group')}
                icon={<Users size={24} />}
                label="Skupina"
              />
            )}
            <NavButton
              active={activeTab === 'summary'}
              onClick={() => setActiveTab('summary')}
              icon={<PieChart size={24} />}
              label="Souhrn"
            />
            <NavButton
              active={activeTab === 'settings'}
              onClick={() => setActiveTab('settings')}
              icon={profile?.photoURL ? (
                <div className="w-6 h-6 rounded-full overflow-hidden border border-primary/20">
                  <img src={profile.photoURL} alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                </div>
              ) : (
                <SettingsIcon size={24} />
              )}
              label="Nastavení"
              badge={invitations.length > 0}
            />
          </div>
        </nav>
    </div>
  );
}

function NavButton({ active, onClick, icon, label, badge }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; badge?: boolean }) {
  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.95 }}
      className={cn(
        "flex flex-col items-center gap-1 transition-all duration-200 flex-1 py-1 relative",
        active ? "text-primary scale-110" : "text-text-muted hover:text-primary"
      )}
    >
      <div className={cn(
        "p-1 rounded-xl transition-colors",
        active ? "bg-bg-soft" : "bg-transparent"
      )}>
        {icon}
      </div>
      <span className="text-[8px] sm:text-[9px] font-bold uppercase tracking-tight sm:tracking-widest text-center truncate max-w-full px-0.5">{label}</span>
      {badge && (
        <span className="absolute top-1 right-1/4 w-2 h-2 bg-red-500 rounded-full border border-white" />
      )}
    </motion.button>
  );
}
