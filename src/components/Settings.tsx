import { useState, useEffect } from 'react';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import { setPersistence, browserLocalPersistence, browserSessionPersistence, deleteUser } from 'firebase/auth';
import { collection, addDoc, doc, updateDoc, deleteDoc, query, where, getDocs, setDoc, serverTimestamp, onSnapshot } from 'firebase/firestore';
import { UserProfile, Trip, Invitation, Person } from '../types';
import { cn } from '../App';
import { Plus, Trash2, LogOut, User, Globe, Tag, Landmark, Palette, X, Monitor, Plane, Sun, Moon, ShieldCheck, Pencil, Check, UserPlus, Users, Bell, UserCheck, Search, Loader2, Copy, CheckCircle2, Coins, RefreshCw, AlertTriangle, Archive, ArchiveRestore, Eye, Download, LayoutGrid, Wallet, Layers, FolderArchive } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import { CURRENCIES, fetchExchangeRates } from '../services/currencyService';
import { calculateAge, formatDateForInput, calculateDaysBetween, addDaysToDate, getDisplayPaidByName } from '../services/dateUtils';
import { Expense } from '../types';

const THEMES = [
  { id: 'default', name: 'Olivová', color: '#5A5A40', icon: <Palette size={16} /> },
  { id: 'midnight', name: 'Půlnoční', color: '#1E293B', icon: <Moon size={16} /> },
  { id: 'ocean', name: 'Oceán', color: '#0369A1', icon: <Globe size={16} /> },
  { id: 'rose', name: 'Růže', color: '#BE123C', icon: <Palette size={16} /> },
  { id: 'forest', name: 'Les', color: '#15803D', icon: <Palette size={16} /> },
  { id: 'purple', name: 'Fialová', color: '#7E22CE', icon: <Palette size={16} /> },
  { id: 'holiday', name: 'Dovolená', color: '#F59E0B', icon: <Plane size={16} /> },
  { id: 'universal', name: 'Univerzální', color: '#FFFFFF', icon: <Sun size={16} /> },
  { id: 'dark', name: 'Tmavý', color: '#0F172A', icon: <Moon size={16} /> },
  { id: 'system', name: 'Podle zařízení', color: '#94A3B8', icon: <Monitor size={16} /> },
];

interface SettingsProps {
  profile: UserProfile;
  trips: Trip[];
  invitations: Invitation[];
  onAcceptInvitation: (invite: Invitation) => Promise<void>;
  onDeclineInvitation: (invite: Invitation) => Promise<void>;
  onLogout: () => void;
  exchangeRates: Record<string, number> | null;
  isLoadingRates: boolean;
  lastRatesUpdate: string | null;
  onRefreshRates: () => Promise<void>;
  onSelectTrip?: (tripId: string) => void;
}

export default function Settings({ 
  profile, 
  trips, 
  invitations, 
  onAcceptInvitation, 
  onDeclineInvitation, 
  onLogout,
  exchangeRates,
  isLoadingRates,
  lastRatesUpdate,
  onRefreshRates,
  onSelectTrip
}: SettingsProps) {
  const [activeSettingsSection, setActiveSettingsSection] = useState<'all' | 'trips' | 'people' | 'categories' | 'profile' | 'archive'>('all');
  const [isExportingTripId, setIsExportingTripId] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    tripName: string;
    type: 'archive' | 'unarchive';
    targetSection?: 'archive' | 'trips';
  } | null>(null);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => {
        setToast(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const activeTrips = trips.filter(t => !t.archived);
  const archivedTrips = trips.filter(t => t.archived);

  const handleToggleArchiveTrip = async (tripId: string, archiveStatus: boolean) => {
    const trip = trips.find(t => t.id === tripId);
    const tripName = trip?.name || 'Výlet';

    try {
      await updateDoc(doc(db, 'trips', tripId), {
        archived: archiveStatus
      });

      setToast({
        message: archiveStatus 
          ? `Výlet "${tripName}" byl archivován a odebrán z vašich výletů.` 
          : `Výlet "${tripName}" byl obnoven mezi vaše aktivní výlety.`,
        tripName,
        type: archiveStatus ? 'archive' : 'unarchive',
        targetSection: archiveStatus ? 'archive' : 'trips'
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `trips/${tripId}`);
    }
  };

  const handleExportArchivedTrip = async (trip: Trip) => {
    setIsExportingTripId(trip.id);
    try {
      const q = query(collection(db, 'expenses'), where('tripId', '==', trip.id));
      const snap = await getDocs(q);
      const expData = snap.docs.map(doc => doc.data() as Expense);

      if (expData.length === 0) {
        alert(`Výlet "${trip.name}" nemá žádné útraty ke stažení.`);
        setIsExportingTripId(null);
        return;
      }

      expData.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      const dataToExport = expData.map(e => ({
        'Datum': format(new Date(e.date), 'dd.MM.yyyy'),
        'Popis': e.description || e.category,
        'Kdo platil': getDisplayPaidByName(e, profile.uid, people),
        'Částka': e.amount,
        'Měna': e.currency,
        'Částka v domovské měně': e.amountInBase,
        'Metoda platby': e.paymentMethod,
        'Kategorie': e.category,
      }));

      const ws = XLSX.utils.json_to_sheet(dataToExport);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Výdaje");
      XLSX.writeFile(wb, `Archiv_${trip.name.replace(/\s+/g, '_')}.xlsx`);
    } catch (err) {
      console.error("Failed to export archived trip:", err);
    } finally {
      setIsExportingTripId(null);
    }
  };

  const [newTripName, setNewTripName] = useState('');
  const [newTripCurrency, setNewTripCurrency] = useState('');
  const [newTripStartDate, setNewTripStartDate] = useState<string>(formatDateForInput(new Date()));
  const [newTripEndDate, setNewTripEndDate] = useState<string>('');
  const [newTripDuration, setNewTripDuration] = useState<string>('');
  const [newTripAdults, setNewTripAdults] = useState<string>('1');
  const [newTripChildren, setNewTripChildren] = useState<string>('0');
  const [newTripIncludeSelf, setNewTripIncludeSelf] = useState<boolean>(true);

  const [newCategory, setNewCategory] = useState('');
  const [newPaymentMethod, setNewPaymentMethod] = useState('');
  const [baseCurrency, setBaseCurrency] = useState(profile.baseCurrency || 'CZK');
  const [displayName, setDisplayName] = useState(profile.displayName || '');
  const [photoURL, setPhotoURL] = useState(profile.photoURL || '');
  const [showProfileEdit, setShowProfileEdit] = useState(false);
  const [confirmDeleteTripId, setConfirmDeleteTripId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showThemeModal, setShowThemeModal] = useState(false);
  const [editingTripId, setEditingTripId] = useState<string | null>(null);
  const [editTripName, setEditTripName] = useState('');
  const [editTripCurrency, setEditTripCurrency] = useState('');
  const [editTripStartDate, setEditTripStartDate] = useState<string>('');
  const [editTripEndDate, setEditTripEndDate] = useState<string>('');
  const [editTripDuration, setEditTripDuration] = useState<string>('');
  const [editTripAdults, setEditTripAdults] = useState<string>('');
  const [editTripChildren, setEditTripChildren] = useState<string>('');
  const [editTripIncludeSelf, setEditTripIncludeSelf] = useState<boolean>(true);
  
  // Sharing states
  const [inviteEmail, setInviteEmail] = useState('');
  const [isSearchingUser, setIsSearchingUser] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [showInviteModal, setShowInviteModal] = useState<string | null>(null); // tripId
  const [showDeleteAccountConfirm, setShowDeleteAccountConfirm] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState<string | null>(null);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [lastInviteId, setLastInviteId] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState<boolean>(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  // Selected people for new trip & editing trip
  const [newTripPeopleIds, setNewTripPeopleIds] = useState<string[]>([]);
  const [editTripPeopleIds, setEditTripPeopleIds] = useState<string[]>([]);
  const [showManualTripCounts, setShowManualTripCounts] = useState(false);
  const [showManualEditCounts, setShowManualEditCounts] = useState(false);

  // Date change handlers for Trip creation & editing
  const handleNewTripStartDateChange = (val: string) => {
    setNewTripStartDate(val);
    if (val && newTripEndDate) {
      const days = calculateDaysBetween(val, newTripEndDate);
      if (days) setNewTripDuration(days.toString());
    } else if (val && newTripDuration) {
      const end = addDaysToDate(val, parseInt(newTripDuration));
      if (end) setNewTripEndDate(end);
    }
  };

  const handleNewTripEndDateChange = (val: string) => {
    setNewTripEndDate(val);
    if (newTripStartDate && val) {
      const days = calculateDaysBetween(newTripStartDate, val);
      if (days) setNewTripDuration(days.toString());
    }
  };

  const handleNewTripDurationChange = (val: string) => {
    setNewTripDuration(val);
    const numDays = parseInt(val);
    if (newTripStartDate && numDays > 0) {
      const end = addDaysToDate(newTripStartDate, numDays);
      if (end) setNewTripEndDate(end);
    }
  };

  const handleEditTripStartDateChange = (val: string) => {
    setEditTripStartDate(val);
    if (val && editTripEndDate) {
      const days = calculateDaysBetween(val, editTripEndDate);
      if (days) setEditTripDuration(days.toString());
    } else if (val && editTripDuration) {
      const end = addDaysToDate(val, parseInt(editTripDuration));
      if (end) setEditTripEndDate(end);
    }
  };

  const handleEditTripEndDateChange = (val: string) => {
    setEditTripEndDate(val);
    if (editTripStartDate && val) {
      const days = calculateDaysBetween(editTripStartDate, val);
      if (days) setEditTripDuration(days.toString());
    }
  };

  const handleEditTripDurationChange = (val: string) => {
    setEditTripDuration(val);
    const numDays = parseInt(val);
    if (editTripStartDate && numDays > 0) {
      const end = addDaysToDate(editTripStartDate, numDays);
      if (end) setEditTripEndDate(end);
    }
  };

  // Helper to calculate adults and children from selected person profiles and 'Já'
  const calculatePersonnel = (selectedIds: string[], includeSelf: boolean, manualAdults: string, manualChildren: string) => {
    if (selectedIds.length === 0 && !includeSelf) {
      return {
        adults: parseInt(manualAdults) || 0,
        children: parseInt(manualChildren) || 0
      };
    }
    let adults = includeSelf ? 1 : 0;
    let children = 0;
    selectedIds.forEach(id => {
      const person = people.find(p => p.id === id);
      if (person) {
        const computedAge = calculateAge(person.birthDate, person.age);
        if (computedAge >= 18) {
          adults++;
        } else {
          children++;
        }
      }
    });
    return { adults, children };
  };

  // Currency states
  const [showCurrencyModal, setShowCurrencyModal] = useState(false);
  const [currencySearch, setCurrencySearch] = useState('');

  // People / Osoby states
  const [people, setPeople] = useState<Person[]>([]);
  const [loadingPeople, setLoadingPeople] = useState(false);
  const [newPersonName, setNewPersonName] = useState('');
  const [newPersonEmail, setNewPersonEmail] = useState('');
  const [newPersonBirthDate, setNewPersonBirthDate] = useState('');
  const [newPersonAge, setNewPersonAge] = useState('');
  const [isAddingPerson, setIsAddingPerson] = useState(false);
  const [personError, setPersonError] = useState<string | null>(null);

  // Editing person state
  const [editingPersonId, setEditingPersonId] = useState<string | null>(null);
  const [editPersonName, setEditPersonName] = useState('');
  const [editPersonEmail, setEditPersonEmail] = useState('');
  const [editPersonBirthDate, setEditPersonBirthDate] = useState('');
  const [editPersonAge, setEditPersonAge] = useState('');
  const [peopleUserData, setPeopleUserData] = useState<Record<string, { uid?: string; displayName?: string; photoURL?: string; isRealUser: boolean }>>({});
  const [personInviteStates, setPersonInviteStates] = useState<Record<string, { loading: boolean; success?: boolean; error?: string; inviteId?: string }>>({});
  const [activeTripInvites, setActiveTripInvites] = useState<Invitation[]>([]);
  const [loadingInvites, setLoadingInvites] = useState(false);
  const [collabProfiles, setCollabProfiles] = useState<UserProfile[]>([]);

  // Synchronize people from Firestore
  useEffect(() => {
    if (!profile.uid) return;
    setLoadingPeople(true);
    const q = query(collection(db, 'people'), where('ownerId', '==', profile.uid));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Person));
      setPeople(list);
      setLoadingPeople(false);
    }, (err) => {
      console.error(err);
      setLoadingPeople(false);
    });
    return unsub;
  }, [profile.uid]);

  // Check which people are registered app users
  useEffect(() => {
    const fetchRealUsers = async () => {
      if (people.length === 0) {
        setPeopleUserData({});
        return;
      }
      
      const emails = people.map(p => (p.email ? p.email.trim().toLowerCase() : '')).filter(Boolean);
      if (emails.length === 0) return;
      
      const dataMap: Record<string, { uid?: string; displayName?: string; photoURL?: string; isRealUser: boolean }> = {};
      
      try {
        const chunks = [];
        for (let i = 0; i < emails.length; i += 10) {
          chunks.push(emails.slice(i, i + 10));
        }
        
        for (const chunk of chunks) {
          const userQ = query(collection(db, 'users'), where('email', 'in', chunk));
          const userSnap = await getDocs(userQ);
          userSnap.forEach(docSnap => {
            const userData = docSnap.data();
            if (userData.email) {
              dataMap[userData.email.toLowerCase()] = {
                uid: docSnap.id,
                displayName: userData.displayName || undefined,
                photoURL: userData.photoURL || undefined,
                isRealUser: true
              };
            }
          });
        }
        setPeopleUserData(dataMap);
      } catch (error) {
        console.error("Failed to check real users:", error);
      }
    };
    
    fetchRealUsers();
  }, [people]);

  // Sync active trip's invitations real-time
  useEffect(() => {
    if (!showInviteModal || !profile.uid) {
      setActiveTripInvites([]);
      return;
    }
    setLoadingInvites(true);
    const q = query(
      collection(db, 'invitations'),
      where('inviterId', '==', profile.uid)
    );
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as Invitation))
        .filter(inv => inv.tripId === showInviteModal);
      setActiveTripInvites(list);
      setLoadingInvites(false);
    }, (err) => {
      console.error("Failed to load invitations for active trip:", err);
      setLoadingInvites(false);
    });
    return unsub;
  }, [showInviteModal, profile.uid]);

  // Fetch collaborator profiles for active trip
  useEffect(() => {
    if (!showInviteModal) {
      setCollabProfiles([]);
      return;
    }
    const fetchCollabs = async () => {
      try {
        const activeTrip = trips.find(t => t.id === showInviteModal);
        if (!activeTrip || !activeTrip.collaborators || activeTrip.collaborators.length === 0) {
          setCollabProfiles([]);
          return;
        }
        const pList: UserProfile[] = [];
        const uniqueUids = Array.from(new Set(activeTrip.collaborators));
        for (const uid of uniqueUids) {
          const docSnap = await getDocs(query(collection(db, 'users'), where('uid', '==', uid)));
          if (!docSnap.empty) {
            pList.push({ uid, ...docSnap.docs[0].data() } as any);
          }
        }
        setCollabProfiles(pList);
      } catch (err) {
        console.error("Failed to fetch collaborator profiles:", err);
      }
    };
    fetchCollabs();
  }, [showInviteModal, trips]);

  const handleAddPerson = async () => {
    const trimmedName = newPersonName.trim();
    const trimmedEmail = newPersonEmail.trim().toLowerCase();
    const computedAge = calculateAge(newPersonBirthDate, parseInt(newPersonAge) || 0);
    
    if (!trimmedName || (isNaN(computedAge) && !newPersonBirthDate)) {
      setPersonError('Prosím vyplňte jméno a datum narození nebo věk.');
      return;
    }
    
    if (trimmedEmail && !trimmedEmail.includes('@')) {
      setPersonError('Zadejte platnou e-mailovou adresu.');
      return;
    }
    
    setPersonError(null);
    try {
      await addDoc(collection(db, 'people'), {
        ownerId: profile.uid,
        name: trimmedName,
        email: trimmedEmail || '',
        birthDate: newPersonBirthDate || null,
        age: computedAge
      });
      // Reset form
      setNewPersonName('');
      setNewPersonEmail('');
      setNewPersonAge('');
      setNewPersonBirthDate('');
      setIsAddingPerson(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'people');
    }
  };

  const startEditingPerson = (person: Person) => {
    setEditingPersonId(person.id);
    setEditPersonName(person.name);
    setEditPersonEmail(person.email || '');
    const bdate = person.birthDate ? formatDateForInput(person.birthDate) : '';
    setEditPersonBirthDate(bdate);
    setEditPersonAge(calculateAge(person.birthDate, person.age).toString());
  };

  const handleUpdatePerson = async (id: string) => {
    const trimmedName = editPersonName.trim();
    const trimmedEmail = editPersonEmail.trim().toLowerCase();
    const computedAge = calculateAge(editPersonBirthDate, parseInt(editPersonAge) || 0);
    
    if (!trimmedName) return;

    try {
      await updateDoc(doc(db, 'people', id), {
        name: trimmedName,
        email: trimmedEmail || '',
        birthDate: editPersonBirthDate || null,
        age: computedAge
      });
      setEditingPersonId(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `people/${id}`);
    }
  };

  const handleDeletePerson = async (id: string) => {
    try {
      // Optimistic update so it disappears immediately without waiting or needing refresh
      setPeople(prev => prev.filter(p => p.id !== id));
      await deleteDoc(doc(db, 'people', id));

      // Clean up this person from all trips where they were selected in trip.people
      for (const t of trips) {
        if (t.people && t.people.includes(id)) {
          const updatedPeople = t.people.filter(pId => pId !== id);
          const { adults, children } = calculatePersonnel(
            updatedPeople, 
            t.includeSelf !== false, 
            t.adults?.toString() || '1', 
            t.children?.toString() || '0'
          );
          try {
            await updateDoc(doc(db, 'trips', t.id), {
              people: updatedPeople,
              adults,
              children
            });
          } catch (e) {
            console.error("Failed to update trip after deleting person:", e);
          }
        }
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `people/${id}`);
    }
  };

  const handleInvitePerson = async (person: Person) => {
    setPersonInviteStates(prev => ({
      ...prev,
      [person.id]: { loading: true }
    }));
    
    try {
      const response = await fetch('/api/send-person-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: person.email,
          inviterName: profile.displayName || profile.email,
          webLink: window.location.origin
        })
      });
      
      if (response.ok) {
        setPersonInviteStates(prev => ({
          ...prev,
          [person.id]: { loading: false, success: true }
        }));
      } else {
        const data = await response.json();
        setPersonInviteStates(prev => ({
          ...prev,
          [person.id]: { loading: false, error: data.error || 'Nepodařilo se poslat pozvánku.' }
        }));
      }
    } catch (err) {
      console.error(err);
      setPersonInviteStates(prev => ({
        ...prev,
        [person.id]: { loading: false, error: 'Chyba sítě.' }
      }));
    }
  };

  // Sync state with profile
  useEffect(() => {
    setBaseCurrency(profile.baseCurrency || 'CZK');
    setDisplayName(profile.displayName || '');
    setPhotoURL(profile.photoURL || '');
  }, [profile.baseCurrency, profile.displayName, profile.photoURL]);

  const handleUpdateProfile = async () => {
    try {
      // Ensure display name is not empty
      if (!displayName.trim()) {
        setUploadError('Jméno nesmí být prázdné.');
        return;
      }

      // Check for display name uniqueness if it changed
      if (displayName.trim() !== profile.displayName) {
        const nameQuery = query(collection(db, 'users'), where('displayName', '==', displayName.trim()));
        const nameSnap = await getDocs(nameQuery);
        if (!nameSnap.empty) {
          setUploadError('Toto jméno již používá jiný uživatel.');
          return;
        }
      }

      await updateDoc(doc(db, 'users', profile.uid), { 
        displayName: displayName.trim(),
        photoURL
      });
      setShowProfileEdit(false);
      setUploadError(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${profile.uid}`);
    }
  };

  const handleSendInvite = async (tripId: string) => {
    const trimmedEmail = inviteEmail.trim().toLowerCase();
    if (!trimmedEmail) return;
    
    // Simple email validation
    if (!trimmedEmail.includes('@')) {
      setSearchError('Zadejte platnou e-mailovou adresu.');
      return;
    }

    setIsSearchingUser(true);
    setSearchError(null);
    setLastInviteId(null);
    setEmailSent(false);
    setEmailError(null);

    try {
      // Find user by email
      const userSnap = await getDocs(query(collection(db, 'users'), where('email', '==', trimmedEmail)));
      let inviteeId = '';
      if (!userSnap.empty) {
        inviteeId = userSnap.docs[0].id;
        if (inviteeId === profile.uid) {
          setSearchError('Nemůžeš pozvat sám sebe.');
          return;
        }
      }
      
      const trip = trips.find(t => t.id === tripId);
      if (inviteeId && trip?.collaborators?.includes(inviteeId)) {
        setSearchError('Uživatel už je spolupracovníkem.');
        return;
      }

      // Create invitation
      const inviteData = {
        tripId,
        tripName: trip?.name || 'Neznámý výlet',
        inviterId: profile.uid,
        inviterName: profile.displayName || 'Někdo',
        inviterEmail: profile.email || '',
        inviteeId: inviteeId || null,
        inviteeEmail: trimmedEmail,
        status: 'pending' as const,
        createdAt: new Date().toISOString()
      };
      const inviteRef = await addDoc(collection(db, 'invitations'), inviteData);

      setActiveTripInvites(prev => {
        const withoutOld = prev.filter(inv => inv.inviteeEmail?.toLowerCase() !== trimmedEmail);
        return [...withoutOld, { id: inviteRef.id, ...inviteData } as Invitation];
      });

      const inviteLink = `${window.location.origin}${window.location.pathname}?invite=${inviteRef.id}`;

      // Send email via our API
      try {
        const response = await fetch('/api/send-invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            inviteEmail: trimmedEmail,
            inviterName: profile.displayName || 'Někdo',
            tripName: trip?.name || 'Neznámý výlet',
            inviteLink
          })
        });
        
        if (response.ok) {
          setEmailSent(true);
        } else {
          const errData = await response.json();
          console.warn('Email sending failed:', errData.error);
          setEmailError(errData.error || 'Neznámá chyba při odesílání e-mailu.');
        }
      } catch (emailErr) {
        console.error('Failed to call email API:', emailErr);
        setEmailError('Nepodařilo se spojit se serverem pro odeslání e-mailu.');
      }

      setLastInviteId(inviteRef.id);
      setInviteEmail('');
      // We don't close the modal yet so they can copy the link
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'invitations');
    } finally {
      setIsSearchingUser(false);
    }
  };

  const handleInvitePersonFromList = async (email: string, name: string) => {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !showInviteModal) return;
    
    setPersonInviteStates(prev => ({
      ...prev,
      [trimmedEmail]: { loading: true }
    }));

    try {
      // Find user by email to get their UID if they exist
      const userSnap = await getDocs(query(collection(db, 'users'), where('email', '==', trimmedEmail)));
      let inviteeId = '';
      if (!userSnap.empty) {
        inviteeId = userSnap.docs[0].id;
        if (inviteeId === profile.uid) {
          setPersonInviteStates(prev => ({
            ...prev,
            [trimmedEmail]: { loading: false, error: 'Nemůžeš pozvat sám sebe.' }
          }));
          return;
        }
      }
      
      const trip = trips.find(t => t.id === showInviteModal);
      if (inviteeId && trip?.collaborators?.includes(inviteeId)) {
        setPersonInviteStates(prev => ({
          ...prev,
          [trimmedEmail]: { loading: false, error: 'Uživatel už je spolupracovníkem.' }
        }));
        return;
      }

      // Create or update invitation
      let inviteId = '';
      const existingInvite = activeTripInvites.find(inv => inv.inviteeEmail?.toLowerCase() === trimmedEmail);
      if (existingInvite) {
        inviteId = existingInvite.id;
        await updateDoc(doc(db, 'invitations', existingInvite.id), {
          status: 'pending',
          createdAt: new Date().toISOString(),
          inviterName: profile.displayName || 'Někdo',
          inviterEmail: profile.email || '',
          tripName: trip?.name || 'Neznámý výlet'
        });
      } else {
        const inviteRef = await addDoc(collection(db, 'invitations'), {
          tripId: showInviteModal,
          tripName: trip?.name || 'Neznámý výlet',
          inviterId: profile.uid,
          inviterName: profile.displayName || 'Někdo',
          inviterEmail: profile.email || '',
          inviteeId: inviteeId || null,
          inviteeEmail: trimmedEmail,
          status: 'pending',
          createdAt: new Date().toISOString()
        });
        inviteId = inviteRef.id;
      }

      // Optimistically update activeTripInvites so status immediately switches to 'ceka_na_prijeti'
      setActiveTripInvites(prev => {
        const withoutOld = prev.filter(inv => inv.inviteeEmail?.toLowerCase() !== trimmedEmail);
        return [...withoutOld, {
          id: inviteId,
          tripId: showInviteModal,
          tripName: trip?.name || 'Neznámý výlet',
          inviterId: profile.uid,
          inviterName: profile.displayName || 'Někdo',
          inviterEmail: profile.email || '',
          inviteeId: inviteeId || undefined,
          inviteeEmail: trimmedEmail,
          status: 'pending',
          createdAt: new Date().toISOString()
        } as Invitation];
      });

      const inviteLink = `${window.location.origin}${window.location.pathname}?invite=${inviteId}`;

      // Send email via our API
      let emailSuccess = false;
      let emailErrMsg = '';
      try {
        const response = await fetch('/api/send-invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            inviteEmail: trimmedEmail,
            inviterName: profile.displayName || 'Někdo',
            tripName: trip?.name || 'Neznámý výlet',
            inviteLink
          })
        });
        
        if (response.ok) {
          emailSuccess = true;
        } else {
          const errData = await response.json();
          emailErrMsg = errData.error || 'Neznámá chyba e-mailu.';
        }
      } catch (emailErr) {
        console.error('Failed to call email API:', emailErr);
        emailErrMsg = 'Nepodařilo se spojit se serverem pro e-mail.';
      }

      setPersonInviteStates(prev => ({
        ...prev,
        [trimmedEmail]: { 
          loading: false, 
          success: true,
          inviteId: inviteId,
          error: emailSuccess ? undefined : (emailErrMsg || 'Chyba při posílání e-mailu.')
        }
      }));
    } catch (error: any) {
      console.error(error);
      setPersonInviteStates(prev => ({
        ...prev,
        [trimmedEmail]: { loading: false, error: error.message || 'Chyba při vytváření pozvánky.' }
      }));
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError(null);

    // Check file size (limit to 400KB to be safe with Firestore 1MB limit and base64 overhead)
    if (file.size > 400 * 1024) {
      setUploadError('Obrázek je příliš velký (max 400KB).');
      e.target.value = '';
      return;
    }

    setIsUploading(true);
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      setPhotoURL(result);
      setIsUploading(false);
      // Reset input value so the same file can be selected again if needed
      e.target.value = '';
    };
    reader.onerror = () => {
      setUploadError('Chyba při čtení souboru.');
      setIsUploading(false);
      e.target.value = '';
    };
    reader.readAsDataURL(file);
  };

  const handleUpdateBaseCurrency = async () => {
    try {
      await updateDoc(doc(db, 'users', profile.uid), { baseCurrency: baseCurrency.toUpperCase() });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${profile.uid}`);
    }
  };

  const handleUpdateTheme = async (themeId: string) => {
    try {
      await updateDoc(doc(db, 'users', profile.uid), { theme: themeId });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${profile.uid}`);
    }
  };

  const handleToggleStayLoggedIn = async () => {
    const newValue = !profile.stayLoggedIn;
    try {
      // Update Firestore
      await updateDoc(doc(db, 'users', profile.uid), { stayLoggedIn: newValue });
      
      // Update Firebase Auth Persistence
      // browserLocalPersistence = stay logged in (default)
      // browserSessionPersistence = logout on tab close
      await setPersistence(
        auth, 
        newValue ? browserLocalPersistence : browserSessionPersistence
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${profile.uid}`);
    }
  };

  const handleToggleShowGroupSection = async () => {
    const newValue = profile.showGroupSection !== false;
    try {
      await updateDoc(doc(db, 'users', profile.uid), { showGroupSection: !newValue });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${profile.uid}`);
    }
  };

  const handleRemoveCollaborator = async (tripId: string, collabUid: string) => {
    if (!window.confirm("Opravdu chcete odebrat přístup tomuto uživateli?")) return;
    try {
      const tripRef = doc(db, 'trips', tripId);
      const trip = trips.find(t => t.id === tripId);
      if (trip && trip.collaborators) {
        const updatedCollabs = trip.collaborators.filter(id => id !== collabUid);
        await updateDoc(tripRef, { collaborators: updatedCollabs });
      }
    } catch (err) {
      console.error("Failed to remove collaborator:", err);
    }
  };

  const handleRemovePersonFromTrip = async (tripId: string, memberId: string, personId?: string, email?: string) => {
    if (!window.confirm("Opravdu chcete tuto osobu odebrat z výletu?")) return;
    try {
      const trip = trips.find(t => t.id === tripId);
      if (!trip) return;

      const tripRef = doc(db, 'trips', tripId);
      
      const idToRemove = personId || memberId;
      const updatedPeople = (trip.people || []).filter(id => id !== idToRemove && id !== memberId);

      const emailLower = email?.trim().toLowerCase();
      const userUid = emailLower ? peopleUserData[emailLower]?.uid : undefined;
      const updatedCollabs = (trip.collaborators || []).filter(cId => 
        cId !== memberId && cId !== idToRemove && (!userUid || cId !== userUid)
      );

      const { adults, children } = calculatePersonnel(
        updatedPeople,
        trip.includeSelf !== false,
        trip.adults?.toString() || '1',
        trip.children?.toString() || '0'
      );

      await updateDoc(tripRef, {
        people: updatedPeople,
        collaborators: updatedCollabs,
        adults,
        children
      });

      if (emailLower) {
        const pendingInvite = activeTripInvites.find(inv => inv.inviteeEmail?.toLowerCase() === emailLower);
        if (pendingInvite) {
          try {
            await deleteDoc(doc(db, 'invitations', pendingInvite.id));
          } catch (invErr) {
            console.error("Failed to remove invitation:", invErr);
          }
        }
      }
    } catch (err) {
      console.error("Failed to remove person from trip:", err);
    }
  };

  const handleCancelInvitation = async (inviteId: string) => {
    if (!window.confirm("Opravdu chcete zrušit tuto pozvánku?")) return;
    try {
      const invToCancel = activeTripInvites.find(inv => inv.id === inviteId);
      if (invToCancel?.inviteeEmail) {
        const emailKey = invToCancel.inviteeEmail.toLowerCase();
        setPersonInviteStates(prev => {
          const next = { ...prev };
          delete next[emailKey];
          return next;
        });
      }
      setActiveTripInvites(prev => prev.filter(inv => inv.id !== inviteId));
      await deleteDoc(doc(db, 'invitations', inviteId));
    } catch (err) {
      console.error("Failed to cancel invitation:", err);
    }
  };

  const handleAddTrip = async () => {
    if (!newTripName || !newTripCurrency) return;
    const { adults, children } = calculatePersonnel(newTripPeopleIds, newTripIncludeSelf, newTripAdults, newTripChildren);
    const startIso = newTripStartDate ? new Date(newTripStartDate).toISOString() : new Date().toISOString();
    const endIso = newTripEndDate ? new Date(newTripEndDate).toISOString() : undefined;

    const newTrip: Omit<Trip, 'id'> = {
      ownerId: profile.uid,
      name: newTripName,
      currency: newTripCurrency.toUpperCase(),
      startDate: startIso,
      endDate: endIso,
      lastRate: 1,
      duration: newTripDuration ? parseInt(newTripDuration) : undefined,
      adults: adults,
      children: children,
      includeSelf: newTripIncludeSelf,
      people: newTripPeopleIds
    };
    try {
      await addDoc(collection(db, 'trips'), newTrip);
      setNewTripName('');
      setNewTripCurrency('');
      setNewTripDuration('');
      setNewTripStartDate(formatDateForInput(new Date()));
      setNewTripEndDate('');
      setNewTripAdults('1');
      setNewTripChildren('0');
      setNewTripPeopleIds([]);
      setNewTripIncludeSelf(true);
      setShowManualTripCounts(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'trips');
    }
  };

  const handleUpdateTrip = async (id: string) => {
    if (!editTripName || !editTripCurrency) return;
    const { adults, children } = calculatePersonnel(editTripPeopleIds, editTripIncludeSelf, editTripAdults, editTripChildren);
    const startIso = editTripStartDate ? new Date(editTripStartDate).toISOString() : new Date().toISOString();
    const endIso = editTripEndDate ? new Date(editTripEndDate).toISOString() : null;

    try {
      await updateDoc(doc(db, 'trips', id), {
        name: editTripName,
        currency: editTripCurrency.toUpperCase(),
        startDate: startIso,
        endDate: endIso,
        duration: editTripDuration ? parseInt(editTripDuration) : null,
        adults: adults,
        children: children,
        includeSelf: editTripIncludeSelf,
        people: editTripPeopleIds
      });
      setEditingTripId(null);
      setEditTripPeopleIds([]);
      setShowManualEditCounts(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `trips/${id}`);
    }
  };

  const startEditingTrip = (trip: Trip) => {
    setEditingTripId(trip.id);
    setEditTripName(trip.name);
    setEditTripCurrency(trip.currency);
    
    const startStr = formatDateForInput(trip.startDate);
    const endStr = trip.endDate ? formatDateForInput(trip.endDate) : (startStr && trip.duration ? addDaysToDate(startStr, trip.duration) : '');

    setEditTripStartDate(startStr);
    setEditTripEndDate(endStr);
    setEditTripDuration(trip.duration?.toString() || '');
    setEditTripAdults(trip.adults?.toString() || '1');
    setEditTripChildren(trip.children?.toString() || '0');
    setEditTripPeopleIds(trip.people || []);
    setEditTripIncludeSelf(trip.includeSelf !== false);
    setShowManualEditCounts(false);
  };

  const handleDeleteTrip = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'trips', id));
      setConfirmDeleteTripId(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `trips/${id}`);
    }
  };

  const handleAddCategory = async () => {
    if (!newCategory) return;
    const updatedCategories = [...profile.categories, newCategory];
    try {
      await updateDoc(doc(db, 'users', profile.uid), { categories: updatedCategories });
      setNewCategory('');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${profile.uid}`);
    }
  };

  const handleDeleteCategory = async (cat: string) => {
    const updatedCategories = profile.categories.filter(c => c !== cat);
    try {
      await updateDoc(doc(db, 'users', profile.uid), { categories: updatedCategories });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${profile.uid}`);
    }
  };

  const handleAddPaymentMethod = async () => {
    if (!newPaymentMethod) return;
    const currentMethods = profile.paymentMethods || ['CASH', 'KARTA', 'PŘEVOD'];
    const updatedMethods = [...currentMethods, newPaymentMethod];
    try {
      await updateDoc(doc(db, 'users', profile.uid), { paymentMethods: updatedMethods });
      setNewPaymentMethod('');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${profile.uid}`);
    }
  };

  const handleDeletePaymentMethod = async (method: string) => {
    const currentMethods = profile.paymentMethods || ['CASH', 'KARTA', 'PŘEVOD'];
    const updatedMethods = currentMethods.filter(m => m !== method);
    try {
      await updateDoc(doc(db, 'users', profile.uid), { paymentMethods: updatedMethods });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${profile.uid}`);
    }
  };

  const handleDeleteAccount = async () => {
    if (!auth.currentUser) return;
    setIsDeletingAccount(true);
    setDeleteAccountError(null);
    try {
      // 1. Delete user document from Firestore
      await deleteDoc(doc(db, 'users', profile.uid));
      
      // 2. Delete user from Firebase Auth
      await deleteUser(auth.currentUser);
      
      // The app will redirect to login automatically via onAuthStateChanged in App.tsx
    } catch (error: any) {
      console.error('Failed to delete account:', error);
      if (error.code === 'auth/requires-recent-login') {
        setDeleteAccountError('Z bezpečnostních důvodů se prosím odhlaste a znovu přihlaste před smazáním účtu.');
      } else {
        setDeleteAccountError('Chyba při mazání účtu: ' + (error.message || 'Neznámá chyba'));
      }
      setIsDeletingAccount(false);
    }
  };

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-400 pb-16">
      {/* Sticky Mobile Sub-Navigation Bar */}
      <div className="sticky top-0 z-20 bg-bg/95 backdrop-blur-md py-2.5 border-b border-border-subtle/70 -mx-4 px-4 mb-3">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar scroll-smooth">
          <button
            onClick={() => setActiveSettingsSection('all')}
            className={cn(
              "px-3.5 py-2 rounded-2xl text-xs font-bold flex items-center gap-1.5 whitespace-nowrap transition-all border shrink-0",
              activeSettingsSection === 'all'
                ? "bg-primary text-white border-primary shadow-xs"
                : "bg-white text-text-muted hover:bg-bg-soft hover:text-primary border-border-subtle"
            )}
          >
            <LayoutGrid size={15} />
            <span>Přehled</span>
          </button>

          <button
            onClick={() => setActiveSettingsSection('trips')}
            className={cn(
              "px-3.5 py-2 rounded-2xl text-xs font-bold flex items-center gap-1.5 whitespace-nowrap transition-all border shrink-0",
              activeSettingsSection === 'trips'
                ? "bg-indigo-600 text-white border-indigo-600 shadow-xs"
                : "bg-indigo-50/80 text-indigo-950 border-indigo-100/80 hover:bg-indigo-100/80"
            )}
          >
            <Globe size={15} className={activeSettingsSection === 'trips' ? 'text-white' : 'text-indigo-600'} />
            <span>Výlety</span>
            <span className={cn(
              "px-1.5 py-0.2 text-[10px] rounded-full font-extrabold",
              activeSettingsSection === 'trips' ? "bg-white/20 text-white" : "bg-indigo-200/90 text-indigo-950"
            )}>
              {activeTrips.length}
            </span>
          </button>

          <button
            onClick={() => setActiveSettingsSection('people')}
            className={cn(
              "px-3.5 py-2 rounded-2xl text-xs font-bold flex items-center gap-1.5 whitespace-nowrap transition-all border shrink-0",
              activeSettingsSection === 'people'
                ? "bg-emerald-600 text-white border-emerald-600 shadow-xs"
                : "bg-emerald-50/80 text-emerald-950 border-emerald-100/80 hover:bg-emerald-100/80"
            )}
          >
            <Users size={15} className={activeSettingsSection === 'people' ? 'text-white' : 'text-emerald-600'} />
            <span>Osoby</span>
            <span className={cn(
              "px-1.5 py-0.2 text-[10px] rounded-full font-extrabold",
              activeSettingsSection === 'people' ? "bg-white/20 text-white" : "bg-emerald-200/90 text-emerald-950"
            )}>
              {people.length}
            </span>
          </button>

          <button
            onClick={() => setActiveSettingsSection('categories')}
            className={cn(
              "px-3.5 py-2 rounded-2xl text-xs font-bold flex items-center gap-1.5 whitespace-nowrap transition-all border shrink-0",
              activeSettingsSection === 'categories'
                ? "bg-amber-600 text-white border-amber-600 shadow-xs"
                : "bg-amber-50/80 text-amber-950 border-amber-100/80 hover:bg-amber-100/80"
            )}
          >
            <Wallet size={15} className={activeSettingsSection === 'categories' ? 'text-white' : 'text-amber-600'} />
            <span>Měny & Kategorie</span>
          </button>

          <button
            onClick={() => setActiveSettingsSection('profile')}
            className={cn(
              "px-3.5 py-2 rounded-2xl text-xs font-bold flex items-center gap-1.5 whitespace-nowrap transition-all border shrink-0",
              activeSettingsSection === 'profile'
                ? "bg-purple-600 text-white border-purple-600 shadow-xs"
                : "bg-purple-50/80 text-purple-950 border-purple-100/80 hover:bg-purple-100/80"
            )}
          >
            <User size={15} className={activeSettingsSection === 'profile' ? 'text-white' : 'text-purple-600'} />
            <span>Profil & Vzhled</span>
          </button>

          <button
            onClick={() => setActiveSettingsSection('archive')}
            className={cn(
              "px-3.5 py-2 rounded-2xl text-xs font-bold flex items-center gap-1.5 whitespace-nowrap transition-all border shrink-0",
              activeSettingsSection === 'archive'
                ? "bg-slate-700 text-white border-slate-700 shadow-xs"
                : "bg-slate-100 text-slate-800 border-slate-200 hover:bg-slate-200"
            )}
          >
            <Archive size={15} className={activeSettingsSection === 'archive' ? 'text-white' : 'text-slate-700'} />
            <span>Archiv</span>
            {archivedTrips.length > 0 && (
              <span className={cn(
                "px-1.5 py-0.2 text-[10px] rounded-full font-extrabold",
                activeSettingsSection === 'archive' ? "bg-white/20 text-white" : "bg-slate-300 text-slate-900"
              )}>
                {archivedTrips.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Back button when viewing specific category */}
      {activeSettingsSection !== 'all' && (
        <div className="flex items-center justify-between px-1 mb-1">
          <button
            onClick={() => setActiveSettingsSection('all')}
            className="text-xs font-bold text-primary hover:underline flex items-center gap-1.5 bg-bg-soft/80 px-3 py-1.5 rounded-xl border border-border-subtle"
          >
            <span>← Zpět na Přehled</span>
          </button>
        </div>
      )}

      {/* OVERVIEW (PŘEHLED) DASHBOARD MODE */}
      {activeSettingsSection === 'all' && (
        <div className="space-y-4 animate-in fade-in duration-300">
          {/* User Quick Card */}
          <div className="bg-white p-4 sm:p-5 rounded-[28px] shadow-xs border border-border-subtle flex items-center justify-between">
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-13 h-13 bg-bg-soft rounded-full flex items-center justify-center text-primary overflow-hidden border-2 border-primary/20 shrink-0 shadow-xs">
                {profile.photoURL ? (
                  <img src={profile.photoURL} alt={profile.displayName} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <User size={26} />
                )}
              </div>
              <div className="min-w-0">
                <h3 className="font-bold text-primary text-base truncate">{profile.displayName || 'Uživatel'}</h3>
                <p className="text-xs text-text-muted truncate">{profile.email}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-md font-bold uppercase tracking-wider">
                    {profile.baseCurrency || 'CZK'}
                  </span>
                  <span className="text-[10px] text-text-muted font-medium">
                    Téma: {THEMES.find(t => t.id === (profile.theme || 'default'))?.name || 'Olivová'}
                  </span>
                </div>
              </div>
            </div>

            <button
              onClick={() => setActiveSettingsSection('profile')}
              className="p-2.5 text-primary bg-bg-soft rounded-2xl hover:bg-primary/10 transition-colors border border-border-subtle shrink-0"
              title="Upravit profil"
            >
              <Pencil size={18} />
            </button>
          </div>

          {/* Quick Category Action Grid */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setActiveSettingsSection('trips')}
              className="p-4 bg-indigo-50/90 hover:bg-indigo-100/90 rounded-[24px] border border-indigo-100 flex flex-col justify-between text-left transition-all shadow-2xs group"
            >
              <div className="flex items-center justify-between w-full mb-3">
                <div className="p-2.5 bg-indigo-600 text-white rounded-xl shadow-xs group-hover:scale-105 transition-transform">
                  <Globe size={20} />
                </div>
                <span className="text-xs bg-indigo-200/90 text-indigo-950 font-extrabold px-2 py-0.5 rounded-full">
                  {activeTrips.length}
                </span>
              </div>
              <div>
                <span className="font-bold text-sm text-indigo-950 block">Výlety</span>
                <p className="text-[11px] text-indigo-700/90 font-medium">Správa a tvorba výletů</p>
              </div>
            </button>

            <button
              onClick={() => setActiveSettingsSection('people')}
              className="p-4 bg-emerald-50/90 hover:bg-emerald-100/90 rounded-[24px] border border-emerald-100 flex flex-col justify-between text-left transition-all shadow-2xs group"
            >
              <div className="flex items-center justify-between w-full mb-3">
                <div className="p-2.5 bg-emerald-600 text-white rounded-xl shadow-xs group-hover:scale-105 transition-transform">
                  <Users size={20} />
                </div>
                <span className="text-xs bg-emerald-200/90 text-emerald-950 font-extrabold px-2 py-0.5 rounded-full">
                  {people.length}
                </span>
              </div>
              <div>
                <span className="font-bold text-sm text-emerald-950 block">Osoby</span>
                <p className="text-[11px] text-emerald-700/90 font-medium">Členové a pozvánky</p>
              </div>
            </button>

            <button
              onClick={() => setActiveSettingsSection('categories')}
              className="p-4 bg-amber-50/90 hover:bg-amber-100/90 rounded-[24px] border border-amber-100 flex flex-col justify-between text-left transition-all shadow-2xs group"
            >
              <div className="flex items-center justify-between w-full mb-3">
                <div className="p-2.5 bg-amber-600 text-white rounded-xl shadow-xs group-hover:scale-105 transition-transform">
                  <Wallet size={20} />
                </div>
                <span className="text-xs bg-amber-200/90 text-amber-950 font-extrabold px-2 py-0.5 rounded-full">
                  {profile.baseCurrency || 'CZK'}
                </span>
              </div>
              <div>
                <span className="font-bold text-sm text-amber-950 block">Měny & Kategorie</span>
                <p className="text-[11px] text-amber-700/90 font-medium">Kurzy, štítky a karty</p>
              </div>
            </button>

            <button
              onClick={() => setActiveSettingsSection('profile')}
              className="p-4 bg-purple-50/90 hover:bg-purple-100/90 rounded-[24px] border border-purple-100 flex flex-col justify-between text-left transition-all shadow-2xs group"
            >
              <div className="flex items-center justify-between w-full mb-3">
                <div className="p-2.5 bg-purple-600 text-white rounded-xl shadow-xs group-hover:scale-105 transition-transform">
                  <User size={20} />
                </div>
                <Palette size={16} className="text-purple-700" />
              </div>
              <div>
                <span className="font-bold text-sm text-purple-950 block">Profil & Vzhled</span>
                <p className="text-[11px] text-purple-700/90 font-medium">Barevné téma a účet</p>
              </div>
            </button>

            <button
              onClick={() => setActiveSettingsSection('archive')}
              className="p-4 bg-slate-100 hover:bg-slate-200/90 rounded-[24px] border border-slate-200 flex flex-col justify-between text-left transition-all shadow-2xs col-span-2 group"
            >
              <div className="flex items-center justify-between w-full mb-2">
                <div className="flex items-center gap-2.5">
                  <div className="p-2.5 bg-slate-700 text-white rounded-xl shadow-xs group-hover:scale-105 transition-transform">
                    <Archive size={20} />
                  </div>
                  <div>
                    <span className="font-bold text-sm text-slate-900 block">Archiv výletů</span>
                    <p className="text-[11px] text-slate-600 font-medium">Historie, zobrazení a stažení v Excelu</p>
                  </div>
                </div>
                {archivedTrips.length > 0 && (
                  <span className="text-xs bg-slate-300 text-slate-900 font-extrabold px-2 py-0.5 rounded-full">
                    {archivedTrips.length}
                  </span>
                )}
              </div>
            </button>
          </div>

          {/* Quick Actions Footer Card */}
          <div className="bg-white p-4 rounded-[28px] border border-border-subtle flex items-center justify-between gap-2">
            <button
              onClick={() => setShowThemeModal(true)}
              className="flex-1 py-2.5 px-3 bg-bg-soft text-primary rounded-2xl font-bold text-xs flex items-center justify-center gap-1.5 hover:bg-primary/10 transition-colors"
            >
              <Palette size={16} />
              <span>Změnit téma</span>
            </button>

            <button
              onClick={onLogout}
              className="flex-1 py-2.5 px-3 bg-red-50 text-red-600 rounded-2xl font-bold text-xs flex items-center justify-center gap-1.5 hover:bg-red-100 transition-colors border border-red-100"
            >
              <LogOut size={16} />
              <span>Odhlásit se</span>
            </button>
          </div>
        </div>
      )}

      {/* Profile Section */}
      {(activeSettingsSection === 'all' || activeSettingsSection === 'profile') && (
        <div className="bg-white rounded-[32px] shadow-sm border border-purple-100 overflow-hidden space-y-0">
          <div className="bg-gradient-to-r from-purple-50/90 to-violet-50/90 px-6 py-4 border-b border-purple-100 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-purple-600 text-white rounded-xl shadow-xs">
                <User size={18} />
              </div>
              <div>
                <h3 className="font-bold text-purple-950 text-base">Profil & Vzhled aplikace</h3>
                <p className="text-[11px] text-purple-700/80 font-medium">Osobní údaje, profilová fotka a barevné téma</p>
              </div>
            </div>
          </div>

          <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-bg-soft rounded-full flex items-center justify-center text-primary overflow-hidden border-2 border-primary/10">
              {profile.photoURL ? (
                <img src={profile.photoURL} alt={profile.displayName} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <User size={32} />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-primary">{profile.displayName || 'Uživatel'}</h3>
                <button 
                  onClick={() => {
                    navigator.clipboard.writeText(profile.displayName || '');
                  }}
                  className="p-1 text-text-muted hover:text-primary transition-colors"
                  title="Kopírovat jméno"
                >
                  <Copy size={14} />
                </button>
              </div>
              <p className="text-xs text-text-muted">{profile.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setShowProfileEdit(!showProfileEdit)}
              className="p-2 text-primary bg-bg-soft rounded-xl hover:bg-[#E5E5E0] transition-colors"
            >
              <User size={20} />
            </button>
            <button onClick={onLogout} className="p-2 text-text-muted hover:text-red-500 transition-colors">
              <LogOut size={20} />
            </button>
          </div>
        </div>

        {showProfileEdit && (
          <div className="space-y-4 pt-4 border-t border-bg-soft animate-in slide-in-from-top-2 duration-200">
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted px-2">Jméno</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Tvoje jméno"
                className="w-full bg-bg-soft rounded-2xl p-3 text-sm focus:ring-2 focus:ring-primary"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted px-2">Profilová fotka</label>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-bg-soft rounded-full overflow-hidden border border-primary/10 flex-shrink-0">
                  {photoURL ? (
                    <img src={photoURL} alt="Preview" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-text-muted"><User size={20} /></div>
                  )}
                </div>
                <div className="flex-1 flex flex-col gap-2">
                  <div className="flex gap-2">
                    <label className="flex-1 bg-bg-soft border-none rounded-2xl p-3 text-sm text-primary cursor-pointer hover:bg-[#E5E5E0] transition-colors text-center font-medium">
                      {isUploading ? 'Nahrávám...' : 'Vybrat fotku'}
                      <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
                    </label>
                    {photoURL && (
                      <button 
                        onClick={() => setPhotoURL('')}
                        className="p-3 bg-red-50 text-red-500 rounded-2xl hover:bg-red-100 transition-colors"
                        title="Odstranit fotku"
                      >
                        <Trash2 size={20} />
                      </button>
                    )}
                  </div>
                  {uploadError && <p className="text-[10px] text-red-500 px-2 font-medium">{uploadError}</p>}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowProfileEdit(false)}
                className="flex-1 bg-bg-soft text-text-muted py-3 rounded-2xl font-medium text-sm"
              >
                Zrušit
              </button>
              <button
                onClick={handleUpdateProfile}
                className="flex-[2] bg-primary text-primary-content py-3 rounded-2xl font-medium text-sm shadow-md active:scale-[0.98]"
              >
                Uložit profil
              </button>
            </div>
          </div>
        )}
          </div>
        </div>
      )}

      {/* Osoby (People) Section */}
      {(activeSettingsSection === 'all' || activeSettingsSection === 'people') && (
        <div className="bg-white rounded-[32px] shadow-sm border border-emerald-100 overflow-hidden space-y-0">
          <div className="bg-gradient-to-r from-emerald-50/90 to-teal-50/90 px-6 py-4 border-b border-emerald-100 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-emerald-600 text-white rounded-xl shadow-xs">
                <Users size={18} />
              </div>
              <div>
                <h3 className="font-bold text-emerald-950 text-base">Osoby a členové</h3>
                <p className="text-[11px] text-emerald-700/80 font-medium">Správa účinkujících/účastníků výletů</p>
              </div>
            </div>
            <button
              onClick={() => setIsAddingPerson(!isAddingPerson)}
              className="text-xs bg-emerald-600 text-white font-bold px-3 py-1.5 rounded-full flex items-center gap-1 hover:scale-[1.02] transition-all shadow-xs"
            >
              <Plus size={14} />
              Přidat
            </button>
          </div>

          <div className="p-6 space-y-4">

        {isAddingPerson && (
          <div className="bg-white p-6 rounded-[32px] shadow-sm space-y-4 border border-primary/5 animate-in slide-in-from-top-2 duration-300">
            <h4 className="font-bold text-sm text-primary">Nová osoba</h4>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted px-2">Jméno</label>
                <input
                  type="text"
                  value={newPersonName}
                  onChange={(e) => setNewPersonName(e.target.value)}
                  placeholder="např. Petr Novák"
                  className="w-full bg-bg-soft rounded-2xl p-3 text-sm focus:ring-2 focus:ring-primary font-medium"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted px-2">E-mail (nepovinný)</label>
                <input
                  type="email"
                  value={newPersonEmail}
                  onChange={(e) => setNewPersonEmail(e.target.value)}
                  placeholder="např. petr@email.cz"
                  className="w-full bg-bg-soft rounded-2xl p-3 text-sm focus:ring-2 focus:ring-primary font-medium"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted px-2">Datum narození</label>
                <input
                  type="date"
                  value={newPersonBirthDate}
                  onChange={(e) => {
                    const bdate = e.target.value;
                    setNewPersonBirthDate(bdate);
                    if (bdate) {
                      const computedAge = calculateAge(bdate, 0);
                      setNewPersonAge(computedAge.toString());
                    }
                  }}
                  className="w-full bg-bg-soft rounded-2xl p-3 text-sm focus:ring-2 focus:ring-primary font-medium"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted px-2">Věk (let)</label>
                <input
                  type="number"
                  value={newPersonAge}
                  onChange={(e) => setNewPersonAge(e.target.value)}
                  placeholder="např. 28"
                  className="w-full bg-bg-soft rounded-2xl p-3 text-sm focus:ring-2 focus:ring-primary font-medium"
                />
              </div>
            </div>

            {personError && (
              <p className="text-[10px] text-red-500 font-medium px-2">{personError}</p>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => {
                  setIsAddingPerson(false);
                  setPersonError(null);
                }}
                className="flex-1 bg-bg-soft text-text-muted py-3 rounded-2xl font-medium text-sm hover:bg-[#E5E5E0] transition-colors"
              >
                Zrušit
              </button>
              <button
                onClick={handleAddPerson}
                className="flex-[2] bg-primary text-primary-content py-3 rounded-2xl font-medium text-sm shadow-md hover:opacity-90 active:scale-[0.98] transition-all"
              >
                Uložit osobu
              </button>
            </div>
          </div>
        )}

        <div className="bg-white p-6 rounded-[32px] shadow-sm space-y-4">
          {loadingPeople ? (
            <div className="flex items-center justify-center p-8 text-text-muted text-sm gap-2">
              <Loader2 size={16} className="animate-spin text-primary" />
              Načítám osoby...
            </div>
          ) : people.length === 0 ? (
            <p className="text-center py-6 text-sm text-text-muted">
              Nemáš zatím přidané žádné osoby. Přidej první kliknutím na tlačítko "Přidat".
            </p>
          ) : (
            <div className="space-y-2">
              {people.map(person => {
                const userEmailLower = person.email ? person.email.trim().toLowerCase() : '';
                const matchedUser = userEmailLower ? peopleUserData[userEmailLower] : null;
                const isRealUser = matchedUser?.isRealUser || false;
                const photo = matchedUser?.photoURL;
                const inviteState = personInviteStates[person.id];
                const currentAge = calculateAge(person.birthDate, person.age);

                if (editingPersonId === person.id) {
                  return (
                    <div key={person.id} className="p-4 bg-bg-soft rounded-2xl space-y-3 border border-primary/20">
                      <h5 className="font-bold text-xs text-primary">Úprava osoby</h5>
                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                        <input
                          type="text"
                          value={editPersonName}
                          onChange={(e) => setEditPersonName(e.target.value)}
                          placeholder="Jméno"
                          className="bg-white rounded-xl p-2.5 text-xs font-medium focus:ring-2 focus:ring-primary"
                        />
                        <input
                          type="email"
                          value={editPersonEmail}
                          onChange={(e) => setEditPersonEmail(e.target.value)}
                          placeholder="E-mail"
                          className="bg-white rounded-xl p-2.5 text-xs font-medium focus:ring-2 focus:ring-primary"
                        />
                        <input
                          type="date"
                          value={editPersonBirthDate}
                          onChange={(e) => {
                            const bdate = e.target.value;
                            setEditPersonBirthDate(bdate);
                            if (bdate) {
                              setEditPersonAge(calculateAge(bdate, 0).toString());
                            }
                          }}
                          className="bg-white rounded-xl p-2.5 text-xs font-medium focus:ring-2 focus:ring-primary"
                        />
                        <input
                          type="number"
                          value={editPersonAge}
                          onChange={(e) => setEditPersonAge(e.target.value)}
                          placeholder="Věk"
                          className="bg-white rounded-xl p-2.5 text-xs font-medium focus:ring-2 focus:ring-primary"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleUpdatePerson(person.id)}
                          className="flex-1 bg-primary text-primary-content py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1"
                        >
                          <Check size={14} /> Uložit
                        </button>
                        <button
                          onClick={() => setEditingPersonId(null)}
                          className="flex-1 bg-white text-text-muted py-2 rounded-xl text-xs font-bold"
                        >
                          Zrušit
                        </button>
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={person.id} className="p-4 bg-bg-soft rounded-2xl flex items-center justify-between group select-none">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center text-primary overflow-hidden border border-primary/10">
                        {photo ? (
                          <img src={photo} alt={person.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        ) : (
                          <User size={20} className="text-primary/70" />
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-bold text-primary text-sm">{person.name}</span>
                          {isRealUser ? (
                            <span className="text-[9px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-bold uppercase tracking-tight">
                              real user
                            </span>
                          ) : (
                            <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-bold uppercase tracking-tight">
                              offline
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-text-muted mt-0.5">
                          {person.email ? `${person.email} • ` : ''}{currentAge} let {person.birthDate ? `(nar. ${new Date(person.birthDate).toLocaleDateString('cs-CZ')})` : ''}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {!isRealUser && person.email && (
                        <div>
                          {inviteState?.success ? (
                            <span className="text-xs text-green-600 font-bold bg-green-50 px-3 py-1.5 rounded-xl border border-green-100 flex items-center gap-1">
                              <CheckCircle2 size={12} /> Pozváno
                            </span>
                          ) : (
                            <button
                              onClick={() => handleInvitePerson(person)}
                              disabled={inviteState?.loading}
                              className="text-xs px-3 py-1.5 bg-primary/10 hover:bg-primary hover:text-white text-primary rounded-xl font-bold transition-all flex items-center gap-1 disabled:opacity-50"
                            >
                              {inviteState?.loading ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                'Pozvat'
                              )}
                            </button>
                          )}
                          {inviteState?.error && (
                            <span className="text-[9px] text-red-500 block text-right mt-1 font-medium max-w-[120px] truncate" title={inviteState.error}>
                              {inviteState.error}
                            </span>
                          )}
                        </div>
                      )}
                      
                      <button
                        onClick={() => startEditingPerson(person)}
                        className="p-2 text-text-muted hover:text-primary transition-colors bg-white rounded-xl shadow-sm border border-black/5"
                        title="Upravit osobu"
                      >
                        <Pencil size={14} />
                      </button>

                      <button
                        onClick={() => handleDeletePerson(person.id)}
                        className="p-2 text-text-muted hover:text-red-500 transition-colors bg-white rounded-xl shadow-sm border border-black/5"
                        title="Odebrat osobu"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
        </div>
      )}

      {/* Base Currency */}
      {(activeSettingsSection === 'categories' || activeSettingsSection === 'profile') && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 px-2">
            <Landmark size={18} className="text-primary" />
            <h3 className="font-bold text-primary">Domácí měna</h3>
          </div>
          <div className="bg-white p-6 rounded-[32px] shadow-sm space-y-4 border border-border-subtle">
            <div className="flex gap-2">
              <input
                type="text"
                value={baseCurrency}
                onChange={(e) => setBaseCurrency(e.target.value.toUpperCase())}
                placeholder="CZK, EUR..."
                className="flex-1 bg-bg-soft rounded-2xl p-3 text-sm focus:ring-2 focus:ring-primary font-bold"
              />
              <button
                onClick={handleUpdateBaseCurrency}
                className="bg-primary text-primary-content px-6 rounded-2xl font-medium text-sm shadow-md active:scale-[0.98]"
              >
                Uložit
              </button>
            </div>
            <p className="text-[10px] text-text-muted px-2">
              Tato měna se používá pro výpočet celkových nákladů a u výběrů z bankomatu.
            </p>
            
            <div className="pt-4 border-t border-bg-soft">
              <button
                onClick={() => setShowCurrencyModal(true)}
                className="w-full flex items-center justify-between p-4 bg-bg-soft rounded-2xl hover:bg-primary/5 transition-all group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-primary rounded-full flex items-center justify-center text-white">
                    <Coins size={20} />
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-bold text-primary">Seznam měn</p>
                    <p className="text-[10px] text-text-muted uppercase tracking-widest font-bold">
                      Aktuální kurzy k {profile.baseCurrency}
                    </p>
                    {lastRatesUpdate && (
                      <p className="text-[8px] text-text-muted italic">
                        Naposledy aktualizováno: {new Date(lastRatesUpdate).toLocaleString('cs-CZ')}
                      </p>
                    )}
                  </div>
                </div>
                <Search className="text-text-muted group-hover:text-primary transition-colors" size={20} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Appearance / Themes */}
      {(activeSettingsSection === 'profile') && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 px-2">
            <Palette size={18} className="text-primary" />
            <h3 className="font-bold text-primary">Vzhled a styl</h3>
          </div>
          <div className="bg-white p-6 rounded-[32px] shadow-sm space-y-4 border border-border-subtle">
          <button
            onClick={() => setShowThemeModal(true)}
            className="w-full flex items-center justify-between p-4 bg-bg-soft rounded-2xl hover:bg-primary/5 transition-all group"
          >
            <div className="flex items-center gap-3">
              <div 
                className="w-10 h-10 rounded-full shadow-sm border-2 border-white" 
                style={{ backgroundColor: THEMES.find(t => t.id === (profile.theme || 'default'))?.color }}
              />
              <div className="text-left">
                <p className="text-sm font-bold text-primary">
                  {THEMES.find(t => t.id === (profile.theme || 'default'))?.name}
                </p>
                <p className="text-[10px] text-text-muted uppercase tracking-widest font-bold">Změnit barevné schéma</p>
              </div>
            </div>
            <Palette className="text-text-muted group-hover:text-primary transition-colors" size={20} />
          </button>

          {/* Stay Logged In Toggle */}
          <div className="pt-4 border-t border-bg-soft">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-bg-soft rounded-full flex items-center justify-center text-primary">
                  <ShieldCheck size={20} />
                </div>
                <div>
                  <p className="text-sm font-bold text-primary">Zůstat přihlášen</p>
                  <p className="text-[10px] text-text-muted uppercase tracking-widest font-bold">Při zavření aplikace</p>
                </div>
              </div>
              <button
                onClick={handleToggleStayLoggedIn}
                className={`w-12 h-6 rounded-full transition-colors relative ${profile.stayLoggedIn !== false ? 'bg-primary' : 'bg-bg-soft'}`}
              >
                <motion.div 
                  animate={{ x: profile.stayLoggedIn !== false ? 24 : 4 }}
                  className="absolute top-1 left-0 w-4 h-4 bg-white rounded-full shadow-sm"
                />
              </button>
            </div>
            <p className="text-[10px] text-text-muted mt-2 px-2">
              Pokud je zapnuto, aplikace si vás bude pamatovat i po zavření prohlížeče nebo aplikace.
            </p>
          </div>

          {/* Show Group Section Toggle */}
          <div className="pt-4 border-t border-bg-soft">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-bg-soft rounded-full flex items-center justify-center text-primary">
                  <Users size={20} />
                </div>
                <div>
                  <p className="text-sm font-bold text-primary">Zobrazit sekci Skupina</p>
                  <p className="text-[10px] text-text-muted uppercase tracking-widest font-bold">Vyúčtování a vyrovnání dluhů</p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleToggleShowGroupSection}
                className={`w-12 h-6 rounded-full transition-colors relative ${profile.showGroupSection !== false ? 'bg-primary' : 'bg-bg-soft'}`}
              >
                <motion.div 
                  animate={{ x: profile.showGroupSection !== false ? 24 : 4 }}
                  className="absolute top-1 left-0 w-4 h-4 bg-white rounded-full shadow-sm"
                />
              </button>
            </div>
            <p className="text-[10px] text-text-muted mt-2 px-2">
              Zobrazí nebo skryje spodní záložku „Skupina“ pro dlužníky a snadné vyrovnání.
            </p>
          </div>
        </div>
      </div>
      )}

      {/* Currency Modal */}
      <AnimatePresence>
        {showCurrencyModal && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white w-full max-w-md rounded-[40px] p-8 shadow-2xl space-y-6 max-h-[85vh] flex flex-col"
            >
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <Coins className="text-primary" size={24} />
                  <h2 className="text-xl font-serif text-primary">Kurzy měn</h2>
                </div>
                <button onClick={() => setShowCurrencyModal(false)} className="p-2 text-text-muted hover:bg-bg-soft rounded-full transition-colors">
                  <X size={24} />
                </button>
              </div>

              <div className="relative">
                <input
                  type="text"
                  value={currencySearch}
                  onChange={(e) => setCurrencySearch(e.target.value)}
                  placeholder="Hledat měnu nebo zemi..."
                  className="w-full bg-bg-soft rounded-2xl p-4 pl-12 text-sm focus:ring-2 focus:ring-primary"
                />
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted" size={20} />
              </div>

              <div className="flex-1 overflow-y-auto pr-2 space-y-2 custom-scrollbar">
                {isLoadingRates ? (
                  <div className="flex flex-col items-center justify-center py-12 space-y-4">
                    <Loader2 size={32} className="text-primary animate-spin" />
                    <p className="text-sm text-text-muted font-medium">Načítám aktuální kurzy...</p>
                  </div>
                ) : (
                  CURRENCIES
                    .filter(c => 
                      c.code.toLowerCase().includes(currencySearch.toLowerCase()) || 
                      c.name.toLowerCase().includes(currencySearch.toLowerCase()) ||
                      c.country.toLowerCase().includes(currencySearch.toLowerCase())
                    )
                    .map(currency => {
                      const rate = exchangeRates ? exchangeRates[currency.code] : null;
                      return (
                        <div key={currency.code} className="flex items-center justify-between p-4 bg-bg-soft rounded-2xl">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center text-primary font-bold text-xs shadow-sm">
                              {currency.code}
                            </div>
                            <div>
                              <p className="text-sm font-bold text-primary">{currency.name}</p>
                              <p className="text-[10px] text-text-muted uppercase tracking-widest font-bold">{currency.country}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            {rate ? (
                              <>
                                <p className="text-sm font-bold text-primary">
                                  {(1 / rate).toFixed(4)} <span className="text-[10px] font-normal">{profile.baseCurrency}</span>
                                </p>
                                <p className="text-[9px] text-text-muted uppercase font-bold">1 {currency.code}</p>
                              </>
                            ) : (
                              <p className="text-[10px] text-text-muted italic">Není k dispozici</p>
                            )}
                          </div>
                        </div>
                      );
                    })
                )}
              </div>

              <div className="pt-4 border-t border-bg-soft flex justify-between items-center">
                <p className="text-[10px] text-text-muted uppercase tracking-widest font-bold">
                  Základní měna: {profile.baseCurrency}
                </p>
                <button 
                  onClick={onRefreshRates}
                  className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-primary hover:underline"
                >
                  <RefreshCw size={12} className={isLoadingRates ? 'animate-spin' : ''} />
                  Aktualizovat
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Theme Modal */}
      <AnimatePresence>
        {showThemeModal && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white w-full max-w-md rounded-[40px] p-8 shadow-2xl space-y-6 max-h-[80vh] overflow-y-auto"
            >
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <Palette className="text-primary" size={24} />
                  <h2 className="text-xl font-serif text-primary">Vyberte si styl</h2>
                </div>
                <button onClick={() => setShowThemeModal(false)} className="p-2 text-text-muted hover:bg-bg-soft rounded-full transition-colors">
                  <X size={24} />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {THEMES.map((theme) => (
                  <button
                    key={theme.id}
                    onClick={() => {
                      handleUpdateTheme(theme.id);
                      setShowThemeModal(false);
                    }}
                    className={`flex flex-col items-center gap-3 p-4 rounded-3xl transition-all border-2 relative overflow-hidden ${
                      (profile.theme || 'default') === theme.id 
                        ? 'border-primary bg-bg-soft shadow-md' 
                        : 'border-transparent bg-bg-soft/50 hover:bg-bg-soft hover:scale-[1.02]'
                    }`}
                  >
                    <div 
                      className="w-12 h-12 rounded-full shadow-lg flex items-center justify-center text-white" 
                      style={{ backgroundColor: theme.color }}
                    >
                      {theme.icon}
                    </div>
                    <div className="text-center">
                      <span className="text-xs font-bold uppercase tracking-widest text-primary block">
                        {theme.name}
                      </span>
                    </div>
                    {(profile.theme || 'default') === theme.id && (
                      <div className="absolute top-2 right-2 w-2 h-2 bg-primary rounded-full" />
                    )}
                  </button>
                ))}
              </div>

              <div className="pt-4 border-t border-bg-soft">
                <p className="text-[10px] text-text-muted text-center uppercase tracking-[0.2em] font-bold">
                  Tip: Režim "Podle zařízení" se automaticky přepne mezi světlým a tmavým stylem.
                </p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Invitations */}
      {invitations.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 px-2">
            <Bell size={18} className="text-primary" />
            <h3 className="font-bold text-primary">Pozvánky</h3>
          </div>
          <div className="bg-white p-6 rounded-[32px] shadow-sm space-y-4">
            {invitations.map(invite => (
              <div key={invite.id} className="flex items-center justify-between p-4 bg-bg-soft rounded-2xl">
                <div className="flex-1">
                  <p className="text-sm font-bold text-primary">{invite.tripName}</p>
                  <p className="text-[10px] text-text-muted uppercase tracking-widest font-bold">Od: {invite.inviterName}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => onAcceptInvitation(invite)}
                    className="p-2 bg-primary text-primary-content rounded-xl shadow-sm"
                    title="Přijmout"
                  >
                    <Check size={18} />
                  </button>
                  <button
                    onClick={() => onDeclineInvitation(invite)}
                    className="p-2 bg-white text-red-500 rounded-xl shadow-sm"
                    title="Odmítnout"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Trips Section */}
      {(activeSettingsSection === 'all' || activeSettingsSection === 'trips') && (
        <div className="bg-white rounded-[32px] shadow-sm border border-indigo-100 overflow-hidden space-y-0">
          <div className="bg-gradient-to-r from-indigo-50/90 to-blue-50/90 px-6 py-4 border-b border-indigo-100 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-indigo-600 text-white rounded-xl shadow-xs">
                <Globe size={18} />
              </div>
              <div>
                <h3 className="font-bold text-indigo-950 text-base">Moje výlety</h3>
                <p className="text-[11px] text-indigo-700/80 font-medium">Aktivní itineráře, rozpočty a trvání</p>
              </div>
            </div>
            <span className="text-xs bg-indigo-100 text-indigo-900 font-bold px-2.5 py-1 rounded-full">
              {activeTrips.length} {activeTrips.length === 1 ? 'aktivní výlet' : activeTrips.length >= 2 && activeTrips.length <= 4 ? 'aktivní výlety' : 'aktivních výletů'}
            </span>
          </div>

          <div className="p-6 space-y-4">
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <input
                type="text"
                value={newTripName}
                onChange={(e) => setNewTripName(e.target.value)}
                placeholder="Název (např. Srí Lanka)"
                className="bg-bg-soft rounded-2xl p-3 text-sm focus:ring-2 focus:ring-primary font-medium"
              />
              <input
                type="text"
                value={newTripCurrency}
                onChange={(e) => setNewTripCurrency(e.target.value)}
                placeholder="Měna (LKR, EUR...)"
                className="bg-bg-soft rounded-2xl p-3 text-sm focus:ring-2 focus:ring-primary font-medium"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted px-2">Datum od</label>
                <input
                  type="date"
                  value={newTripStartDate}
                  onChange={(e) => handleNewTripStartDateChange(e.target.value)}
                  className="w-full bg-bg-soft rounded-2xl p-2.5 text-xs focus:ring-2 focus:ring-primary font-medium"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted px-2">Datum do</label>
                <input
                  type="date"
                  value={newTripEndDate}
                  onChange={(e) => handleNewTripEndDateChange(e.target.value)}
                  className="w-full bg-bg-soft rounded-2xl p-2.5 text-xs focus:ring-2 focus:ring-primary font-medium"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted px-2">Počet dní</label>
                <input
                  type="number"
                  value={newTripDuration}
                  onChange={(e) => handleNewTripDurationChange(e.target.value)}
                  placeholder="Automaticky"
                  className="w-full bg-bg-soft rounded-2xl p-2.5 text-xs focus:ring-2 focus:ring-primary font-medium"
                />
              </div>
            </div>
          </div>

          {/* New Trip Personnel Selection */}
          <div className="space-y-2 border-t border-bg-soft pt-3">
            <div className="flex items-center justify-between px-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted">Kdo jede na výlet? (Osoby)</label>
              <button
                type="button"
                onClick={() => setNewTripIncludeSelf(!newTripIncludeSelf)}
                className={cn(
                  "px-2.5 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 transition-all border",
                  newTripIncludeSelf 
                    ? "bg-primary text-white border-primary" 
                    : "bg-bg-soft text-text-muted border-primary/10"
                )}
              >
                <div className={cn("w-3 h-3 rounded flex items-center justify-center border", newTripIncludeSelf ? "bg-white text-primary" : "border-text-muted")}>
                  {newTripIncludeSelf && <Check size={8} strokeWidth={3} />}
                </div>
                <span>Zahrnout mě ("Já")</span>
              </button>
            </div>

            {people.length === 0 ? (
              <p className="text-xs text-text-muted px-2">Nemáš uloženy žádné další osoby. Můžeš je přidat v sekci "Osoby" výše, nebo zadat počty ručně.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 px-1">
                {people.map(person => {
                  const isSelected = newTripPeopleIds.includes(person.id);
                  const pAge = calculateAge(person.birthDate, person.age);
                  return (
                    <button
                      key={person.id}
                      type="button"
                      onClick={() => {
                        if (isSelected) {
                          setNewTripPeopleIds(newTripPeopleIds.filter(id => id !== person.id));
                        } else {
                          setNewTripPeopleIds([...newTripPeopleIds, person.id]);
                        }
                      }}
                      className={cn(
                        "p-2.5 rounded-xl border text-left text-xs font-medium flex items-center gap-2 transition-all",
                        isSelected 
                          ? "bg-primary/5 border-primary text-primary font-bold shadow-sm"
                          : "bg-white border-primary/10 text-primary/70 hover:bg-bg-soft"
                      )}
                    >
                      <div className={cn("w-3.5 h-3.5 rounded flex items-center justify-center border", isSelected ? "bg-primary border-primary text-white" : "border-primary/20 bg-white")}>
                        {isSelected && <Check size={10} strokeWidth={3} />}
                      </div>
                      <span className="truncate">{person.name} ({pAge} {pAge >= 18 ? 'let' : 'r.'})</span>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="flex items-center justify-between px-2 text-xs font-semibold text-text-muted mt-2">
              <span>
                Vypočteno: {calculatePersonnel(newTripPeopleIds, newTripIncludeSelf, newTripAdults, newTripChildren).adults} dospělých, {calculatePersonnel(newTripPeopleIds, newTripIncludeSelf, newTripAdults, newTripChildren).children} dětí
              </span>
              <button
                type="button"
                onClick={() => setShowManualTripCounts(!showManualTripCounts)}
                className="text-primary hover:underline text-[11px] font-bold"
              >
                {showManualTripCounts ? "Skrýt ruční počty" : "Zadat ruční počty"}
              </button>
            </div>

            {showManualTripCounts && (
              <div className="flex gap-2 p-3 bg-bg-soft rounded-2xl animate-in fade-in slide-in-from-top-1 duration-200">
                <div className="flex-1 space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted px-2">Dospělí ručně</label>
                  <input
                    type="number"
                    value={newTripAdults}
                    onChange={(e) => setNewTripAdults(e.target.value)}
                    placeholder="Dospělí"
                    className="w-full bg-white rounded-xl p-2.5 text-sm focus:ring-2 focus:ring-primary font-medium"
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted px-2">Děti ručně</label>
                  <input
                    type="number"
                    value={newTripChildren}
                    onChange={(e) => setNewTripChildren(e.target.value)}
                    placeholder="Děti"
                    className="w-full bg-white rounded-xl p-2.5 text-sm focus:ring-2 focus:ring-primary font-medium"
                  />
                </div>
              </div>
            )}
          </div>

          <button
            onClick={handleAddTrip}
            className="w-full bg-primary text-primary-content py-3 rounded-2xl font-medium text-sm shadow-md active:scale-[0.98]"
          >
            Přidat výlet
          </button>

          <div className="space-y-2 pt-4 border-t border-bg-soft">
            {activeTrips.length === 0 ? (
              <div className="text-center py-6 text-text-muted space-y-1">
                <Globe size={28} className="mx-auto text-text-muted/40" />
                <p className="text-xs font-semibold">Žádné aktivní výlety</p>
                <p className="text-[10px]">Vytvořte nový výlet výše nebo obnovte archivovaný výlet z archivu.</p>
              </div>
            ) : (
              <AnimatePresence mode="popLayout">
                {activeTrips.map(trip => (
                  <motion.div 
                    key={trip.id} 
                    layout
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9, height: 0, overflow: 'hidden' }}
                    transition={{ duration: 0.25 }}
                    className="p-3 bg-bg-soft rounded-2xl space-y-3"
                  >
                    {editingTripId === trip.id ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={editTripName}
                        onChange={(e) => setEditTripName(e.target.value)}
                        className="bg-white rounded-xl p-2 text-xs focus:ring-1 focus:ring-primary"
                        placeholder="Název"
                      />
                      <input
                        type="text"
                        value={editTripCurrency}
                        onChange={(e) => setEditTripCurrency(e.target.value)}
                        className="bg-white rounded-xl p-2 text-xs focus:ring-1 focus:ring-primary"
                        placeholder="Měna"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div className="space-y-0.5">
                        <label className="text-[9px] font-bold uppercase text-text-muted px-1">Od</label>
                        <input
                          type="date"
                          value={editTripStartDate}
                          onChange={(e) => handleEditTripStartDateChange(e.target.value)}
                          className="w-full bg-white rounded-lg p-1.5 text-xs focus:ring-1 focus:ring-primary font-medium"
                        />
                      </div>
                      <div className="space-y-0.5">
                        <label className="text-[9px] font-bold uppercase text-text-muted px-1">Do</label>
                        <input
                          type="date"
                          value={editTripEndDate}
                          onChange={(e) => handleEditTripEndDateChange(e.target.value)}
                          className="w-full bg-white rounded-lg p-1.5 text-xs focus:ring-1 focus:ring-primary font-medium"
                        />
                      </div>
                      <div className="space-y-0.5">
                        <label className="text-[9px] font-bold uppercase text-text-muted px-1">Dny</label>
                        <input
                          type="number"
                          value={editTripDuration}
                          onChange={(e) => handleEditTripDurationChange(e.target.value)}
                          placeholder="Dny"
                          className="w-full bg-white rounded-lg p-1.5 text-xs focus:ring-1 focus:ring-primary font-medium"
                        />
                      </div>
                    </div>

                    <div className="space-y-2 border-t border-black/5 pt-3 mt-2">
                      <div className="flex items-center justify-between px-1">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted">Kdo jede na výlet? (Osoby)</label>
                        <button
                          type="button"
                          onClick={() => setEditTripIncludeSelf(!editTripIncludeSelf)}
                          className={cn(
                            "px-2 py-0.5 rounded-full text-[10px] font-bold flex items-center gap-1 transition-all border",
                            editTripIncludeSelf 
                              ? "bg-primary text-white border-primary" 
                              : "bg-white text-text-muted border-primary/10"
                          )}
                        >
                          <div className={cn("w-2.5 h-2.5 rounded flex items-center justify-center border", editTripIncludeSelf ? "bg-white text-primary" : "border-text-muted")}>
                            {editTripIncludeSelf && <Check size={6} strokeWidth={3} />}
                          </div>
                          <span>Zahrnout mě ("Já")</span>
                        </button>
                      </div>

                      {people.length === 0 ? (
                        <p className="text-[11px] text-text-muted px-1">Nemáš uloženy žádné další osoby.</p>
                      ) : (
                        <div className="grid grid-cols-2 gap-1.5">
                          {people.map(person => {
                            const isSelected = editTripPeopleIds.includes(person.id);
                            const pAge = calculateAge(person.birthDate, person.age);
                            return (
                              <button
                                key={person.id}
                                type="button"
                                onClick={() => {
                                  if (isSelected) {
                                    setEditTripPeopleIds(editTripPeopleIds.filter(id => id !== person.id));
                                  } else {
                                    setEditTripPeopleIds([...editTripPeopleIds, person.id]);
                                  }
                                }}
                                className={cn(
                                  "p-2 rounded-lg border text-left text-[11px] font-medium flex items-center gap-1.5 transition-all",
                                  isSelected 
                                    ? "bg-primary/5 border-primary text-primary font-bold shadow-sm"
                                    : "bg-white border-primary/10 text-primary/70 hover:bg-bg-soft"
                                )}
                              >
                                <div className={cn("w-3 h-3 rounded flex items-center justify-center border", isSelected ? "bg-primary border-primary text-white" : "border-primary/20 bg-white")}>
                                  {isSelected && <Check size={8} strokeWidth={3} />}
                                </div>
                                <span className="truncate">{person.name} ({pAge} {pAge >= 18 ? 'let' : 'r.'})</span>
                              </button>
                            );
                          })}
                        </div>
                      )}

                      <div className="flex items-center justify-between px-1 text-[11px] font-semibold text-text-muted mt-1">
                        <span>
                          Vypočteno: {calculatePersonnel(editTripPeopleIds, editTripIncludeSelf, editTripAdults, editTripChildren).adults} dospělých, {calculatePersonnel(editTripPeopleIds, editTripIncludeSelf, editTripAdults, editTripChildren).children} dětí
                        </span>
                        <button
                          type="button"
                          onClick={() => setShowManualEditCounts(!showManualEditCounts)}
                          className="text-primary hover:underline font-bold"
                        >
                          {showManualEditCounts ? "Skrýt" : "Upravit ručně"}
                        </button>
                      </div>

                      {showManualEditCounts && (
                        <div className="flex gap-2 p-2 bg-white/70 rounded-xl">
                          <div className="flex-1 space-y-0.5">
                            <label className="text-[9px] font-bold uppercase text-text-muted px-1">Dospělí ručně</label>
                            <input
                              type="number"
                              value={editTripAdults}
                              onChange={(e) => setEditTripAdults(e.target.value)}
                              placeholder="Dospělí"
                              className="w-full bg-white border border-black/5 rounded-lg p-1.5 text-xs focus:ring-1 focus:ring-primary"
                            />
                          </div>
                          <div className="flex-1 space-y-0.5">
                            <label className="text-[9px] font-bold uppercase text-text-muted px-1">Děti ručně</label>
                            <input
                              type="number"
                              value={editTripChildren}
                              onChange={(e) => setEditTripChildren(e.target.value)}
                              placeholder="Děti"
                              className="w-full bg-white border border-black/5 rounded-lg p-1.5 text-xs focus:ring-1 focus:ring-primary"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleUpdateTrip(trip.id)}
                        className="flex-1 bg-primary text-primary-content py-2 rounded-xl text-[10px] font-bold flex items-center justify-center gap-1"
                      >
                        <Check size={14} /> Uložit
                      </button>
                      <button
                        onClick={() => setEditingTripId(null)}
                        className="flex-1 bg-white text-text-muted py-2 rounded-xl text-[10px] font-bold"
                      >
                        Zrušit
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-bold text-primary">{trip.name}</span>
                        <span className="text-xs text-text-muted ml-2">({trip.currency})</span>
                        {(trip.adults !== undefined || trip.children !== undefined) && (
                          <span className="text-[10px] text-text-muted ml-2 bg-white px-2 py-0.5 rounded-full border border-border-subtle">
                            {trip.adults || 0}d + {trip.children || 0}č
                          </span>
                        )}
                        {trip.ownerId !== profile.uid && (
                          <span className="ml-2 text-[8px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full uppercase font-bold tracking-tighter">Sdílený</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {trip.ownerId === profile.uid && (
                          <>
                            <button 
                              onClick={() => setShowInviteModal(trip.id)}
                              className="text-text-muted hover:text-primary transition-colors"
                              title="Pozvat spolupracovníka"
                            >
                              <UserPlus size={16} />
                            </button>
                            <button 
                              onClick={() => startEditingTrip(trip)}
                              className="text-text-muted hover:text-primary transition-colors"
                              title="Upravit výlet"
                            >
                              <Pencil size={16} />
                            </button>
                            <button 
                              onClick={() => handleToggleArchiveTrip(trip.id, true)}
                              className="text-text-muted hover:text-amber-600 transition-colors"
                              title="Archivovat výlet"
                            >
                              <Archive size={16} />
                            </button>
                            {confirmDeleteTripId === trip.id ? (
                              <div className="flex items-center gap-1">
                                <button 
                                  onClick={() => handleDeleteTrip(trip.id)}
                                  className="p-1 px-2 text-[10px] font-bold bg-red-500 text-white rounded-md"
                                >
                                  Smazat
                                </button>
                                <button 
                                  onClick={() => setConfirmDeleteTripId(null)}
                                  className="p-1 px-2 text-[10px] font-bold bg-bg-soft text-text-muted rounded-md"
                                >
                                  X
                                </button>
                              </div>
                            ) : (
                              <button onClick={() => setConfirmDeleteTripId(trip.id)} className="text-text-muted hover:text-red-500 transition-colors">
                                <Trash2 size={16} />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                    
                    {/* Collaborators list */}
                    {trip.collaborators && trip.collaborators.length > 0 && (
                      <div className="flex items-center gap-2 pt-2 border-t border-white/50">
                        <Users size={12} className="text-text-muted" />
                        <div className="flex -space-x-2">
                          {trip.collaborators.map((collabId, idx) => (
                            <div key={collabId} className="w-5 h-5 rounded-full bg-white border border-bg-soft flex items-center justify-center text-[8px] font-bold text-primary overflow-hidden" title={collabId}>
                              {idx + 1}
                            </div>
                          ))}
                        </div>
                        <span className="text-[10px] text-text-muted">{trip.collaborators.length} {trip.collaborators.length === 1 ? 'spolupracovník' : 'spolupracovníci'}</span>
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>
        </div>
      </div>
    )}

      {/* Invite Modal */}
      <AnimatePresence>
        {showInviteModal && (() => {
          const activeTrip = trips.find(t => t.id === showInviteModal);
          if (!activeTrip) return null;

          const tripPeopleIds = activeTrip.people || [];
          const tripCollabs = activeTrip.collaborators || [];
          
          const tripMembersList: Array<{
            id: string;
            personId?: string;
            name: string;
            email: string;
            isOwner: boolean;
            isRealUser: boolean;
            photoURL?: string;
            status: 'bez_emailu' | 'nepozvan' | 'ceka_na_prijeti' | 'může_upravovat' | 'odmitnuto';
            roleText: string;
            inviteId?: string;
          }> = [];
          
          // 1. Add Owner
          tripMembersList.push({
            id: 'owner',
            name: activeTrip.ownerId === profile.uid ? `Já (${profile.displayName || profile.email || 'Majitel'})` : 'Majitel výletu',
            email: activeTrip.ownerId === profile.uid ? (profile.email || '') : '',
            isOwner: true,
            isRealUser: true,
            photoURL: activeTrip.ownerId === profile.uid ? (profile.photoURL || undefined) : undefined,
            status: 'může_upravovat',
            roleText: 'Majitel výletu'
          });

          // 2. Add members of trip.people
          tripPeopleIds.forEach(pId => {
            const person = people.find(p => p.id === pId);
            if (person) {
              const pEmail = person.email?.trim().toLowerCase();
              const hasUser = pEmail && peopleUserData[pEmail]?.isRealUser;
              const userUid = pEmail && peopleUserData[pEmail]?.uid;
              const isCollab = userUid && tripCollabs.includes(userUid);
              
              let status: 'bez_emailu' | 'nepozvan' | 'ceka_na_prijeti' | 'může_upravovat' | 'odmitnuto' = 'nepozvan';
              let inviteId = undefined;

              if (!pEmail) {
                status = 'bez_emailu';
              } else if (isCollab) {
                status = 'může_upravovat';
              } else {
                const pInvite = activeTripInvites.find(inv => inv.inviteeEmail?.toLowerCase() === pEmail);
                if (pInvite) {
                  if (pInvite.status === 'pending') {
                    status = 'ceka_na_prijeti';
                    inviteId = pInvite.id;
                  } else if (pInvite.status === 'declined') {
                    status = 'odmitnuto';
                    inviteId = pInvite.id;
                  }
                }
              }

              tripMembersList.push({
                id: person.id,
                personId: person.id,
                name: person.name,
                email: person.email || '',
                isOwner: false,
                isRealUser: !!hasUser,
                photoURL: pEmail ? (peopleUserData[pEmail]?.photoURL || undefined) : undefined,
                status,
                roleText: hasUser ? 'Real user' : 'Pouze účastník',
                inviteId
              });
            }
          });

          // 3. Add collaborators from tripCollabs who are not already added
          tripCollabs.forEach(collabId => {
            if (collabId === activeTrip.ownerId) return; // already owner
            const collabProfile = collabProfiles.find(cp => cp.uid === collabId);
            const email = collabProfile?.email?.trim().toLowerCase();
            
            const alreadyAdded = tripMembersList.some(m => m.email && m.email.trim().toLowerCase() === email);
            if (!alreadyAdded) {
              tripMembersList.push({
                id: collabId,
                name: collabProfile?.displayName || collabProfile?.email || 'Spolupracovník',
                email: collabProfile?.email || '',
                isOwner: false,
                isRealUser: true,
                photoURL: collabProfile?.photoURL || undefined,
                status: 'může_upravovat',
                roleText: 'Real user',
                inviteId: undefined
              });
            }
          });

          return (
            <div className="fixed inset-0 bg-black/45 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="bg-white w-full max-w-lg rounded-[40px] p-6 sm:p-8 shadow-2xl flex flex-col max-h-[90vh]"
              >
                {/* Header */}
                <div className="flex justify-between items-center mb-4 pb-2 border-b border-bg-soft">
                  <div className="flex items-center gap-3">
                    <UserPlus className="text-primary" size={24} />
                    <div>
                      <h2 className="text-lg font-serif text-primary leading-tight">Spolupracovníci výletu</h2>
                      <p className="text-xs text-text-muted mt-0.5">{activeTrip.name}</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => { 
                      setShowInviteModal(null); 
                      setSearchError(null); 
                      setLastInviteId(null); 
                      setEmailSent(false); 
                      setEmailError(null); 
                      setPersonInviteStates({});
                    }} 
                    className="p-2 text-text-muted hover:bg-bg-soft rounded-full transition-colors"
                  >
                    <X size={24} />
                  </button>
                </div>

                {/* List of members */}
                <div className="flex-1 overflow-y-auto space-y-3 pr-1 py-2 scrollbar-thin max-h-[40vh]">
                  <h3 className="text-[10px] font-bold uppercase tracking-wider text-text-muted mb-2 px-1">Seznam osob</h3>
                  {tripMembersList.map((member) => {
                    const rowInviteState = member.email ? personInviteStates[member.email.toLowerCase()] : null;
                    const isRowInviting = rowInviteState?.loading;
                    const hasRowSuccess = rowInviteState?.success;
                    
                    return (
                      <div key={member.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 bg-bg-soft rounded-2xl hover:bg-bg-soft/80 transition-shadow gap-2.5">
                        <div className="flex items-center gap-3 min-w-0">
                          {/* Avatar */}
                          <div className="relative flex-shrink-0">
                            {member.photoURL ? (
                              <img 
                                src={member.photoURL} 
                                alt={member.name} 
                                className="w-10 h-10 rounded-full object-cover border border-white"
                                referrerPolicy="no-referrer"
                              />
                            ) : (
                              <div className="w-10 h-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center font-bold text-primary text-sm">
                                {member.name.charAt(0).toUpperCase()}
                              </div>
                            )}
                            {member.isRealUser && (
                              <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-purple-500 rounded-full border border-white flex items-center justify-center text-[8px] text-white font-bold" title="Real user">
                                R
                              </div>
                            )}
                          </div>

                          {/* Profile Details */}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs font-semibold text-text-main" title={member.name}>
                                {member.name}
                              </span>
                              {member.isOwner && (
                                <span className="text-[9px] bg-blue-100 text-blue-700 font-bold px-1.5 py-0.5 rounded-md">Majitel</span>
                              )}
                              {member.isRealUser && !member.isOwner && (
                                <span className="text-[9px] bg-purple-100 text-purple-700 font-medium px-1.5 py-0.5 rounded-md">Real user</span>
                              )}
                            </div>
                            <p className="text-[10px] text-text-muted truncate mt-0.5 max-w-[200px] sm:max-w-xs" title={member.email}>
                              {member.email ? member.email : 'Bez e-mailové adresy'}
                            </p>
                          </div>
                        </div>

                        {/* Status badge / invite action button */}
                        <div className="flex items-center gap-2 flex-shrink-0 pl-[52px] sm:pl-0">
                          {member.status === 'může_upravovat' && (
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] bg-green-100 text-green-700 px-2 py-1 rounded-xl font-bold flex items-center gap-1">
                                <CheckCircle2 size={12} /> Může upravovat
                              </span>
                            </div>
                          )}

                          {member.status === 'bez_emailu' && (
                            <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-1 rounded-xl font-medium">
                              Jen účastník
                            </span>
                          )}

                          {(member.status === 'ceka_na_prijeti' || hasRowSuccess) && (
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-1 rounded-xl font-bold flex items-center gap-1 border border-amber-200/25">
                                <Loader2 size={10} className="animate-spin text-amber-600" /> Čeká na přijetí
                              </span>
                              <button
                                type="button"
                                onClick={() => handleInvitePersonFromList(member.email, member.name)}
                                disabled={isRowInviting}
                                className="text-[10px] bg-primary text-white font-bold px-2 py-1 rounded-xl hover:bg-primary-dark active:scale-95 transition-all flex items-center gap-1 shadow-sm disabled:opacity-50"
                                title="Znovu odeslat pozvánku"
                              >
                                {isRowInviting ? (
                                  <>
                                    <Loader2 size={10} className="animate-spin" /> Odesílám...
                                  </>
                                ) : (
                                  'Pozvat znovu'
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const invId = member.inviteId || rowInviteState?.inviteId;
                                  if (invId) {
                                    navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}?invite=${invId}`);
                                  }
                                }}
                                className="p-1 text-text-muted hover:text-primary hover:bg-white rounded transition-colors"
                                title="Zkopírovat odkaz"
                              >
                                <Copy size={13} />
                              </button>
                              {activeTrip.ownerId === profile.uid && (member.inviteId || rowInviteState?.inviteId) && (
                                <button
                                  type="button"
                                  onClick={() => handleCancelInvitation(member.inviteId || rowInviteState?.inviteId!)}
                                  className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded transition-colors"
                                  title="Zrušit pozvánku"
                                >
                                  <X size={14} />
                                </button>
                              )}
                            </div>
                          )}

                          {member.status === 'odmitnuto' && !hasRowSuccess && (
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] bg-red-100 text-red-700 px-2 py-1 rounded-xl font-bold">Odmítnuto</span>
                              <button
                                type="button"
                                onClick={() => handleInvitePersonFromList(member.email, member.name)}
                                disabled={isRowInviting}
                                className="text-[10px] bg-primary text-white font-bold px-2 py-1 rounded-xl hover:bg-primary-dark active:scale-95 transition-all"
                              >
                                {isRowInviting ? 'Odesílám...' : 'Znovu pozvat'}
                              </button>
                            </div>
                          )}

                          {member.status === 'nepozvan' && !hasRowSuccess && (
                            <button
                              onClick={() => handleInvitePersonFromList(member.email, member.name)}
                              disabled={isRowInviting}
                              className="text-[10px] bg-primary text-white font-bold px-2.5 py-1.5 rounded-xl hover:bg-primary-dark active:scale-95 transition-all flex items-center gap-1 shadow-sm disabled:opacity-50"
                            >
                              {isRowInviting ? (
                                <>
                                  <Loader2 size={10} className="animate-spin" /> Odesílám...
                                </>
                              ) : (
                                'Pozvat na výlet'
                              )}
                            </button>
                          )}

                          {/* Consistently allow owner to remove ANY member from the trip */}
                          {activeTrip.ownerId === profile.uid && !member.isOwner && (
                            <button
                              type="button"
                              onClick={() => handleRemovePersonFromTrip(activeTrip.id, member.id, member.personId, member.email)}
                              className="p-1 px-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors border border-red-200/25 flex items-center gap-0.5"
                              title="Odebrat z výletu"
                            >
                              <Trash2 size={12} />
                              <span className="text-[9px] font-bold">Odebrat</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Inviting someone not in trip.people */}
                <div className="border-t border-bg-soft pt-4 mt-2 space-y-3">
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-text-muted px-1">Pozvat někoho dalšího</h4>
                  <div className="space-y-2">
                    <div className="relative">
                      <input
                        type="email"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        placeholder="e-mail-noveho-spolupracovnika@seznam.cz"
                        className="w-full bg-bg-soft rounded-2xl p-3.5 pr-12 text-xs focus:ring-2 focus:ring-primary font-medium"
                      />
                      <div className="absolute right-4 top-1/2 -translate-y-1/2 text-text-muted">
                        {isSearchingUser ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                      </div>
                    </div>
                    {searchError && <p className="text-[10px] text-red-500 px-2 font-medium">{searchError}</p>}
                  </div>
                  
                  {lastInviteId ? (
                    <div className="p-3.5 bg-green-50 rounded-2xl border border-green-100 space-y-2 animate-in fade-in zoom-in-95 duration-300">
                      <div className="flex items-center gap-2 text-green-700">
                        <CheckCircle2 size={16} />
                        <p className="text-[10px] font-bold uppercase tracking-wider">
                          {emailSent ? 'E-mail odeslán!' : 'Pozvánka vytvořena!'}
                        </p>
                      </div>
                      <p className="text-[10px] text-green-600">
                        Pozvánku se můžete pokusit odeslat ručně kopírováním odkazu:
                      </p>
                      <div className="flex gap-2">
                        <input 
                          readOnly 
                          value={`${window.location.origin}${window.location.pathname}?invite=${lastInviteId}`}
                          className="flex-1 bg-white border border-green-200 rounded-xl p-2 text-[9px] font-mono text-green-800"
                        />
                        <button 
                          onClick={() => {
                            navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}?invite=${lastInviteId}`);
                          }}
                          className="p-2 bg-green-600 text-white rounded-xl hover:bg-green-700 transition-colors"
                        >
                          <Copy size={14} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleSendInvite(showInviteModal)}
                      disabled={isSearchingUser || !inviteEmail}
                      className="w-full bg-primary text-primary-content py-3 rounded-2xl font-bold text-xs shadow-sm active:scale-[0.98] disabled:opacity-50 disabled:scale-100"
                    >
                      Odeslat pozvánku
                    </button>
                  )}
                </div>
              </motion.div>
            </div>
          );
        })()}
      </AnimatePresence>

      {/* Categories & Payment Methods Section */}
      {(activeSettingsSection === 'all' || activeSettingsSection === 'categories') && (
        <div className="bg-white rounded-[32px] shadow-sm border border-amber-100 overflow-hidden space-y-0">
          <div className="bg-gradient-to-r from-amber-50/90 to-orange-50/90 px-6 py-4 border-b border-amber-100 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-amber-600 text-white rounded-xl shadow-xs">
                <Wallet size={18} />
              </div>
              <div>
                <h3 className="font-bold text-amber-950 text-base">Kategorie & Platební metody</h3>
                <p className="text-[11px] text-amber-700/80 font-medium">Správa štítků výdajů a platebních karet</p>
              </div>
            </div>
          </div>

          <div className="p-6 space-y-6">
            {/* Categories */}
            <div className="space-y-3">
              <h4 className="font-bold text-xs text-primary uppercase tracking-wider">Kategorie</h4>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  placeholder="Nová kategorie"
                  className="flex-1 bg-bg-soft rounded-2xl p-3 text-sm focus:ring-2 focus:ring-primary font-medium"
                />
                <button
                  onClick={handleAddCategory}
                  className="bg-primary text-primary-content px-4 rounded-2xl font-bold text-sm shadow-xs"
                >
                  <Plus size={20} />
                </button>
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                {profile.categories.map(cat => (
                  <div key={cat} className="flex items-center gap-2 px-3 py-1.5 bg-bg-soft text-primary rounded-full text-sm font-medium border border-primary/5">
                    {cat}
                    <button onClick={() => handleDeleteCategory(cat)} className="text-text-muted hover:text-red-500 transition-colors">
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Payment Methods */}
            <div className="space-y-3 pt-4 border-t border-bg-soft">
              <h4 className="font-bold text-xs text-primary uppercase tracking-wider">Platební metody (karty)</h4>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newPaymentMethod}
                  onChange={(e) => setNewPaymentMethod(e.target.value)}
                  placeholder="Nová karta / metoda"
                  className="flex-1 bg-bg-soft rounded-2xl p-3 text-sm focus:ring-2 focus:ring-primary font-medium"
                />
                <button
                  onClick={handleAddPaymentMethod}
                  className="bg-primary text-primary-content px-4 rounded-2xl font-bold text-sm shadow-xs"
                >
                  <Plus size={20} />
                </button>
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                {(profile.paymentMethods || ['CASH', 'KARTA', 'PŘEVOD'])
                  .filter(m => m !== 'CASH')
                  .map(method => (
                  <div key={method} className="flex items-center gap-2 px-3 py-1.5 bg-bg-soft text-primary rounded-full text-sm font-medium border border-primary/5">
                    {method}
                    <button onClick={() => handleDeletePaymentMethod(method)} className="text-text-muted hover:text-red-500 transition-colors">
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Archive Section */}
      {(activeSettingsSection === 'all' || activeSettingsSection === 'archive') && (
        <div className="bg-white rounded-[32px] shadow-sm border border-slate-200 overflow-hidden space-y-0">
          <div className="bg-gradient-to-r from-slate-100 to-slate-200/80 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-slate-700 text-white rounded-xl shadow-xs">
                <FolderArchive size={18} />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-base">Archiv výletů</h3>
                <p className="text-[11px] text-slate-600 font-medium">Prohlížení, stažení v Excelu a odarchivování výletů</p>
              </div>
            </div>
            <span className="text-xs bg-slate-200 text-slate-800 font-bold px-2.5 py-1 rounded-full border border-slate-300">
              {archivedTrips.length} {archivedTrips.length === 1 ? 'archivovaný výlet' : 'archivovaných výletů'}
            </span>
          </div>

          <div className="p-6 space-y-3">
            {archivedTrips.length === 0 ? (
              <div className="text-center py-8 space-y-2">
                <Archive size={32} className="mx-auto text-slate-300" />
                <p className="text-sm font-medium text-slate-500">Žádné archivované výlety.</p>
                <p className="text-xs text-slate-400">Výlety můžete archivovat v sekci „Výlety“ tlačítkem s ikonou archivu.</p>
              </div>
            ) : (
              <AnimatePresence mode="popLayout">
                {archivedTrips.map(trip => (
                  <motion.div 
                    key={trip.id} 
                    layout
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9, height: 0, overflow: 'hidden' }}
                    transition={{ duration: 0.25 }}
                    className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-100/50 transition-colors"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-slate-900 text-sm">{trip.name}</h4>
                        <span className="text-[10px] bg-slate-200 text-slate-700 font-extrabold px-2 py-0.5 rounded-md">
                          {trip.currency || 'CZK'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {trip.startDate ? new Date(trip.startDate).toLocaleDateString('cs-CZ') : 'Bez data'}
                        {trip.endDate ? ` – ${new Date(trip.endDate).toLocaleDateString('cs-CZ')}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                      {onSelectTrip && (
                        <button
                          onClick={() => onSelectTrip(trip.id)}
                          className="px-3 py-1.5 bg-white text-slate-700 border border-slate-300 text-xs font-bold rounded-xl flex items-center gap-1.5 hover:bg-slate-50 transition-colors shadow-2xs"
                          title="Prohlédnout výlet"
                        >
                          <Eye size={14} /> Prohlédnout
                        </button>
                      )}
                      <button
                        onClick={() => handleExportArchivedTrip(trip)}
                        disabled={isExportingTripId === trip.id}
                        className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 hover:bg-emerald-700 transition-colors shadow-xs disabled:opacity-50"
                        title="Stáhnout v Excelu"
                      >
                        {isExportingTripId === trip.id ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Download size={14} />
                        )}
                        <span>Export Excel</span>
                      </button>
                      <button
                        onClick={() => handleToggleArchiveTrip(trip.id, false)}
                        className="px-3 py-1.5 bg-slate-700 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 hover:bg-slate-800 transition-colors shadow-xs active:scale-95"
                        title="Odarchivovat výlet"
                      >
                        <ArchiveRestore size={14} /> Odarchivovat
                      </button>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            )}
          </div>
        </div>
      )}

      {/* Danger Zone */}
      {(activeSettingsSection === 'all' || activeSettingsSection === 'profile') && (
        <div className="space-y-4 pt-4">
          <div className="flex items-center gap-2 px-2">
            <AlertTriangle size={18} className="text-red-500" />
            <h3 className="font-bold text-red-500">Nebezpečná zóna</h3>
          </div>
          
          <div className="bg-red-50/30 p-6 rounded-[32px] border border-red-100 space-y-4">
            <p className="text-xs text-text-muted px-2">
              Smazání účtu je nevratný proces. Dojde k odstranění vašeho profilu. Výlety, které vlastníte, zůstanou v databázi, ale ztratíte k nim přístup.
            </p>
            
            {showDeleteAccountConfirm ? (
              <div className="space-y-4 p-4 bg-white rounded-2xl border border-red-200">
                <p className="text-sm font-bold text-primary text-center">Opravdu chcete smazat svůj účet?</p>
                {deleteAccountError && (
                  <p className="text-xs text-red-500 bg-red-50 p-3 rounded-xl border border-red-100 font-medium leading-relaxed">
                    {deleteAccountError}
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowDeleteAccountConfirm(false)}
                    disabled={isDeletingAccount}
                    className="flex-1 py-3 bg-bg-soft text-text-muted rounded-xl font-bold text-xs"
                  >
                    Zrušit
                  </button>
                  <button
                    onClick={handleDeleteAccount}
                    disabled={isDeletingAccount}
                    className="flex-1 py-3 bg-red-500 text-white rounded-xl font-bold text-xs shadow-md active:scale-[0.98] flex items-center justify-center gap-2"
                  >
                    {isDeletingAccount ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <>Potvrdit smazání</>
                    )}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowDeleteAccountConfirm(true)}
                className="w-full py-4 px-6 border-2 border-dashed border-red-200 rounded-2xl text-red-500 text-sm font-bold hover:bg-red-50 hover:border-red-300 transition-all flex items-center justify-center gap-2"
              >
                <Trash2 size={18} />
                Smazat můj účet
              </button>
            )}
          </div>
        </div>
      )}

      {/* Toast Notification for Archiving / Unarchiving */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-[92%] max-w-md bg-slate-900/95 backdrop-blur-md text-white p-4 rounded-2xl shadow-2xl border border-slate-700/80 flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className={cn(
                "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 font-bold shadow-xs",
                toast.type === 'archive' ? "bg-amber-500/20 text-amber-400 border border-amber-500/30" : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
              )}>
                {toast.type === 'archive' ? <Archive size={20} /> : <ArchiveRestore size={20} />}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-white truncate">
                  {toast.type === 'archive' ? 'Výlet archivován' : 'Výlet odarchivován'}
                </p>
                <p className="text-[11px] text-slate-300 leading-tight line-clamp-2">
                  {toast.message}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {toast.targetSection && activeSettingsSection !== toast.targetSection && (
                <button
                  onClick={() => {
                    setActiveSettingsSection(toast.targetSection!);
                    setToast(null);
                  }}
                  className="px-2.5 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-[11px] font-bold transition-colors whitespace-nowrap active:scale-95"
                >
                  {toast.targetSection === 'archive' ? 'Otevřít archiv' : 'Zobrazit výlety'}
                </button>
              )}
              <button
                onClick={() => setToast(null)}
                className="p-1 text-slate-400 hover:text-white transition-colors"
                title="Zavřít"
              >
                <X size={16} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
