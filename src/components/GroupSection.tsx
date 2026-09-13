import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Expense, Withdrawal, Trip, UserProfile, Person } from '../types';
import { 
  Users, 
  Coins, 
  Lock, 
  Unlock, 
  ArrowRight, 
  RotateCcw, 
  TrendingUp, 
  Check, 
  RefreshCw, 
  DollarSign, 
  ChevronRight, 
  User, 
  AlertCircle,
  X,
  Calendar,
  Tag,
  Globe,
  Info
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { motion, AnimatePresence } from 'motion/react';

interface GroupSectionProps {
  expenses: Expense[];
  withdrawals: Withdrawal[];
  trip: Trip;
  profile: UserProfile;
  people: Person[];
  exchangeRates: Record<string, number> | null;
}

// Map categories to modern visual styles
const getCategoryStyles = (category: string) => {
  const normalized = category.toLowerCase().trim();
  if (normalized.includes('jídlo') || normalized.includes('restaurace') || normalized.includes('snídaně') || normalized.includes('food')) {
    return {
      bg: 'bg-orange-50 border-orange-100',
      text: 'text-orange-700',
      badgeBg: 'bg-orange-100/80 text-orange-800'
    };
  }
  if (normalized.includes('ubytov') || normalized.includes('hotel') || normalized.includes('camp') || normalized.includes('stay')) {
    return {
      bg: 'bg-purple-50 border-purple-100',
      text: 'text-purple-700',
      badgeBg: 'bg-purple-100/80 text-purple-800'
    };
  }
  if (normalized.includes('doprav') || normalized.includes('taxi') || normalized.includes('jízden') || normalized.includes('auto') || normalized.includes('benz') || normalized.includes('phm') || normalized.includes('transport')) {
    return {
      bg: 'bg-sky-50 border-sky-100',
      text: 'text-sky-700',
      badgeBg: 'bg-sky-100/80 text-sky-800'
    };
  }
  if (normalized.includes('zábav') || normalized.includes('vstup') || normalized.includes('kino') || normalized.includes('bar') || normalized.includes('pivo') || normalized.includes('entertainment')) {
    return {
      bg: 'bg-emerald-50 border-emerald-100',
      text: 'text-emerald-700',
      badgeBg: 'bg-emerald-100/80 text-emerald-800'
    };
  }
  if (normalized.includes('nákup') || normalized.includes('obchod') || normalized.includes('suvený') || normalized.includes('shopping')) {
    return {
      bg: 'bg-amber-50 border-amber-100',
      text: 'text-amber-700',
      badgeBg: 'bg-amber-100/80 text-amber-800'
    };
  }
  return {
    bg: 'bg-slate-50 border-slate-100',
    text: 'text-slate-700',
    badgeBg: 'bg-slate-100/80 text-slate-800'
  };
};

export default function GroupSection({ 
  expenses, 
  withdrawals, 
  trip, 
  profile, 
  people, 
  exchangeRates 
}: GroupSectionProps) {
  const [peoplePhotos, setPeoplePhotos] = useState<Record<string, string>>({});
  const [customSplits, setCustomSplits] = useState<Record<string, { shouldPayInBase: number; isLocked: boolean }>>({});
  
  // Modals / Details states
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  const [selectedTransfer, setSelectedTransfer] = useState<{
    tx: any;
    paidFrom: number;
    shouldPayFrom: number;
    paidTo: number;
    shouldPayTo: number;
  } | null>(null);

  // Exchange rate logic for trip currency
  const displayRate = useMemo(() => {
    const tripCurrencyRates = withdrawals.filter(w => (w.currency || trip.currency) === trip.currency);
    
    if (tripCurrencyRates.length > 0) {
      return tripCurrencyRates.reduce((sum, w) => sum + w.rate, 0) / tripCurrencyRates.length;
    } else if (exchangeRates && exchangeRates[trip.currency.toUpperCase()]) {
      return 1 / exchangeRates[trip.currency.toUpperCase()];
    } else if (trip.lastRate) {
      return trip.lastRate;
    }
    return 1;
  }, [withdrawals, trip.currency, trip.lastRate, exchangeRates]);

  const activeCurrency = trip.currency;

  // Helper converters
  const convertToBase = (valInActive: number) => {
    return valInActive * displayRate;
  };

  const convertToActive = (valInBase: number) => {
    return displayRate > 0 ? valInBase / displayRate : 0;
  };

  const formatValue = (valInBase: number) => {
    const converted = convertToActive(valInBase);
    const isCzk = activeCurrency.toUpperCase() === 'CZK';
    if (isCzk) {
      return Math.round(converted).toLocaleString('cs-CZ');
    } else {
      return (Math.round(converted * 100) / 100).toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
  };

  // Sync participant photos from 'users' Firestore collection
  useEffect(() => {
    const fetchPhotos = async () => {
      const emails = (trip.people || [])
        .map(pId => people.find(p => p.id === pId)?.email?.trim().toLowerCase())
        .filter(Boolean) as string[];

      if (emails.length === 0) return;

      try {
        const photoMap: Record<string, string> = {};
        const chunks = [];
        for (let i = 0; i < emails.length; i += 10) {
          chunks.push(emails.slice(i, i + 10));
        }

        for (const chunk of chunks) {
          const userQ = query(collection(db, 'users'), where('email', 'in', chunk));
          const userSnap = await getDocs(userQ);
          userSnap.forEach(docSnap => {
            const data = docSnap.data();
            if (data.email && data.photoURL) {
              photoMap[data.email.toLowerCase()] = data.photoURL;
            }
          });
        }
        setPeoplePhotos(prev => ({ ...prev, ...photoMap }));
      } catch (err) {
        console.error("Error fetching participant photos:", err);
      }
    };

    fetchPhotos();
  }, [trip.people, people]);

  // Load custom splits from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(`trip_splits_${trip.id}`);
    if (saved) {
      try {
        setCustomSplits(JSON.parse(saved));
      } catch (err) {
        console.error("Error parsing splits:", err);
        setCustomSplits({});
      }
    } else {
      setCustomSplits({});
    }
  }, [trip.id]);

  const saveSplits = (newSplits: Record<string, { shouldPayInBase: number; isLocked: boolean }>) => {
    setCustomSplits(newSplits);
    localStorage.setItem(`trip_splits_${trip.id}`, JSON.stringify(newSplits));
  };

  const [collabUsers, setCollabUsers] = useState<any[]>([]);

  // Load collaborator profiles
  useEffect(() => {
    if (!trip.collaborators || trip.collaborators.length === 0) {
      setCollabUsers([]);
      return;
    }
    const fetchCollabs = async () => {
      try {
        const list: any[] = [];
        for (const uid of trip.collaborators || []) {
          const docRef = doc(db, 'users', uid);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            list.push({ uid, ...docSnap.data() });
          }
        }
        setCollabUsers(list);
      } catch (err) {
        console.error("Failed to fetch collaborators in GroupSection:", err);
      }
    };
    fetchCollabs();
  }, [trip.collaborators]);

  // Participants list setup (Owner 'me' + trip people + active collaborators)
  const participantsList = useMemo(() => {
    const list = [
      {
        id: 'me',
        name: profile.displayName || 'Já',
        email: profile.email,
        photoURL: profile.photoURL,
        initial: (profile.displayName || 'J').charAt(0).toUpperCase()
      }
    ];

    if (trip.people) {
      trip.people.forEach(pId => {
        const person = people.find(p => p.id === pId);
        if (person) {
          const pEmail = person.email?.trim().toLowerCase();
          list.push({
            id: person.id,
            name: person.name,
            email: person.email || '',
            photoURL: pEmail ? peoplePhotos[pEmail] : undefined,
            initial: person.name.charAt(0).toUpperCase()
          });
        }
      });
    }

    // Add collaborators if they are not already in the list by email
    collabUsers.forEach(cu => {
      if (cu.uid === profile.uid) return; // already added as 'me'
      const cuEmail = cu.email?.trim().toLowerCase();
      
      const alreadyAdded = list.some(p => p.email && p.email.trim().toLowerCase() === cuEmail);
      if (!alreadyAdded) {
        list.push({
          id: cu.uid,
          name: cu.displayName || cu.email || 'Spolupracovník',
          email: cu.email || '',
          photoURL: cu.photoURL,
          initial: (cu.displayName || cu.email || 'S').charAt(0).toUpperCase()
        });
      }
    });

    return list;
  }, [trip.people, people, profile, peoplePhotos, collabUsers]);

  // Sum of payments each participant made (in Base Currency)
  const paidPerParticipant = useMemo(() => {
    const sums: Record<string, number> = {};
    participantsList.forEach(p => {
      sums[p.id] = 0;
    });

    expenses.forEach(e => {
      if (e.tripId !== trip.id) return;
      const payerId = e.paidBy || 'me';
      if (sums[payerId] !== undefined) {
        sums[payerId] += e.amountInBase;
      } else {
        // Fallback to 'me' if payer not matching
        sums['me'] += e.amountInBase;
      }
    });
    return sums;
  }, [expenses, trip.id, participantsList]);

  // Total spent in Base Currency
  const totalTripInBase = useMemo(() => {
    return expenses
      .filter(e => e.tripId === trip.id)
      .reduce((sum, e) => sum + e.amountInBase, 0);
  }, [expenses, trip.id]);

  // Calculated base share for each participant based on expenses splitBetween
  const calculatedSharesFromExpenses = useMemo(() => {
    const shares: Record<string, number> = {};
    participantsList.forEach(p => {
      shares[p.id] = 0;
    });

    expenses.forEach(e => {
      if (e.tripId !== trip.id) return;
      
      // Determine affected participants
      let affected = e.splitBetween && e.splitBetween.length > 0
        ? e.splitBetween.filter(id => participantsList.some(p => p.id === id))
        : [];
      
      if (affected.length === 0) {
        affected = participantsList.map(p => p.id);
      }

      const sharePerPerson = e.amountInBase / affected.length;
      affected.forEach(id => {
        if (shares[id] !== undefined) {
          shares[id] += sharePerPerson;
        }
      });
    });

    return shares;
  }, [expenses, trip.id, participantsList]);

  // Dynamic distribution math
  const finalSharesInBase = useMemo(() => {
    const result: Record<string, number> = {};
    const lockedList = participantsList.filter(p => customSplits[p.id]?.isLocked);
    const unlockedList = participantsList.filter(p => !customSplits[p.id]?.isLocked);

    const totalLockedSum = lockedList.reduce((sum, p) => {
      return sum + (customSplits[p.id]?.shouldPayInBase || 0);
    }, 0);

    if (unlockedList.length > 0) {
      const remainingTotal = Math.max(0, totalTripInBase - totalLockedSum);
      
      const sumUnlockedCalculated = unlockedList.reduce((sum, p) => {
        return sum + (calculatedSharesFromExpenses[p.id] || 0);
      }, 0);

      participantsList.forEach(p => {
        if (customSplits[p.id]?.isLocked) {
          result[p.id] = customSplits[p.id].shouldPayInBase;
        } else {
          if (sumUnlockedCalculated > 0) {
            result[p.id] = remainingTotal * ((calculatedSharesFromExpenses[p.id] || 0) / sumUnlockedCalculated);
          } else {
            result[p.id] = remainingTotal / unlockedList.length;
          }
        }
      });
    } else {
      // All are locked. Use values directly
      participantsList.forEach(p => {
        result[p.id] = customSplits[p.id]?.shouldPayInBase || 0;
      });
    }

    return result;
  }, [participantsList, customSplits, totalTripInBase, calculatedSharesFromExpenses]);

  // Edit callback - Automatically locks share on edit, and unlocks if value is cleared (null)
  const handleEditShouldPay = (pId: string, enteredValInActive: number | null) => {
    const updated = { ...customSplits };
    
    if (enteredValInActive === null || isNaN(enteredValInActive)) {
      // Clear split setting to unlock
      delete updated[pId];
    } else {
      const valInActive = enteredValInActive < 0 ? 0 : enteredValInActive;
      const valInBase = convertToBase(valInActive);
      updated[pId] = {
        shouldPayInBase: valInBase,
        isLocked: true
      };
    }

    saveSplits(updated);
  };

  // Reset splits
  const handleResetSplits = () => {
    saveSplits({});
  };

  // Debt settling algorithm to calculate minimized transfers
  const settlementTransfers = useMemo(() => {
    const balances = participantsList.map(p => {
      const paid = paidPerParticipant[p.id] || 0;
      const shouldPay = finalSharesInBase[p.id] || 0;
      return {
        id: p.id,
        name: p.name,
        photoURL: p.photoURL,
        initial: p.initial,
        net: paid - shouldPay // positive = creditor, negative = debtor
      };
    });

    const debtors = balances
      .filter(b => b.net < -0.01)
      .map(b => ({ ...b, net: Math.abs(b.net) }))
      .sort((a, b) => b.net - a.net);

    const creditors = balances
      .filter(b => b.net > 0.01)
      .sort((a, b) => b.net - a.net);

    const transfers: { 
      from: { id: string; name: string; photoURL?: string; initial: string }; 
      to: { id: string; name: string; photoURL?: string; initial: string }; 
      amountInBase: number 
    }[] = [];

    let dIdx = 0;
    let cIdx = 0;

    while (dIdx < debtors.length && cIdx < creditors.length) {
      const debtor = debtors[dIdx];
      const creditor = creditors[cIdx];

      const payment = Math.min(debtor.net, creditor.net);
      if (payment > 0.01) {
        transfers.push({
          from: { id: debtor.id, name: debtor.name, photoURL: debtor.photoURL, initial: debtor.initial },
          to: { id: creditor.id, name: creditor.name, photoURL: creditor.photoURL, initial: creditor.initial },
          amountInBase: payment
        });
      }

      debtor.net -= payment;
      creditor.net -= payment;

      if (debtor.net < 0.01) dIdx++;
      if (creditor.net < 0.01) cIdx++;
    }

    return transfers;
  }, [participantsList, paidPerParticipant, finalSharesInBase]);

  // Individual paid transactions grouped by participant
  const listExpensesForPayer = (pId: string) => {
    return expenses
      .filter(e => e.tripId === trip.id && (e.paidBy || 'me') === pId)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  };

  // Helper to format currency symbol nicely
  const getSymbol = () => {
    if (activeCurrency.toUpperCase() === 'CZK') return 'Kč';
    if (activeCurrency.toUpperCase() === 'EUR') return '€';
    if (activeCurrency.toUpperCase() === 'USD') return '$';
    return activeCurrency;
  };

  // Check if sums of 'should pays' matches the total, only warn if all are locked & don't match
  const sumShouldPaysInBase = useMemo(() => {
    return participantsList.reduce((sum, p) => sum + (finalSharesInBase[p.id] || 0), 0);
  }, [participantsList, finalSharesInBase]);

  const showMathWarning = Math.abs(sumShouldPaysInBase - totalTripInBase) > 1.0;

  return (
    <div className="space-y-6 pb-24" id="group-section-root">
      {/* Global Stats Grid */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white p-4 rounded-2xl border border-bg-soft shadow-sm flex flex-col justify-between">
          <div className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-2">Celková útrata</div>
          <div className="text-2xl font-black text-primary tracking-tight">
            {formatValue(totalTripInBase)} <span className="text-sm font-semibold">{getSymbol()}</span>
          </div>
          <div className="text-[9px] font-bold text-text-muted/70 uppercase tracking-widest mt-1">Celý výlet</div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-bg-soft shadow-sm flex flex-col justify-between">
          <div className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-2">Standardní podíl</div>
          <div className="text-2xl font-black text-emerald-600 tracking-tight">
            {participantsList.length > 0 ? formatValue(totalTripInBase / participantsList.length) : 0}{' '}
            <span className="text-sm font-semibold text-emerald-600/80">{getSymbol()}</span>
          </div>
          <div className="text-[9px] font-bold text-emerald-500 uppercase tracking-widest mt-1">
            Na osobu ({participantsList.length} dospělých)
          </div>
        </div>
      </div>

      {/* Warning for locked maths */}
      {showMathWarning && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 p-3.5 rounded-2xl text-xs font-semibold">
          <AlertCircle size={16} className="mt-0.5 shrink-0 text-amber-600" />
          <div>
            Součet rozdělených částek ({formatValue(sumShouldPaysInBase)} {getSymbol()}) neodpovídá celkové útratě ({formatValue(totalTripInBase)} {getSymbol()}) kvůli manuálním zámkům.
          </div>
        </div>
      )}

      {/* Jmenovky a Transakce (Who Paid - Grid of Participant spendings) */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-widest text-text-muted px-1 flex items-center gap-1.5">
          <Coins size={14} className="text-primary/70" /> Jmenovky & Výdaje plátců
        </h3>
        
        {/* Horizontal scrollable row for mobile / responsive cards on desktop */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {participantsList.map(p => {
            const payerExpenses = listExpensesForPayer(p.id);
            const totalPaid = paidPerParticipant[p.id] || 0;

            return (
              <div 
                key={p.id}
                className="bg-white rounded-2xl border border-bg-soft p-4 shadow-sm flex flex-col justify-between space-y-4"
              >
                {/* Participant Identity Header */}
                <div className="flex items-center gap-3">
                  {p.photoURL ? (
                    <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-primary/10 shadow-sm shrink-0">
                      <img src={p.photoURL} alt={p.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    </div>
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-primary/5 border border-primary/20 flex items-center justify-center text-primary font-bold text-sm shadow-sm shrink-0 uppercase select-none">
                      {p.initial}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <h4 className="text-sm font-bold text-primary truncate leading-tight">{p.name}</h4>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted/60">
                      {p.id === 'me' ? 'Správce' : 'Člen skupiny'}
                    </span>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-bold text-text-muted leading-none uppercase tracking-widest mb-1">Zaplatil(a)</div>
                    <div className="text-sm font-black text-primary">
                      {formatValue(totalPaid)} <span className="text-[10px] font-semibold">{getSymbol()}</span>
                    </div>
                  </div>
                </div>

                {/* Individual Transactions list under participant */}
                <div className="space-y-1.5 max-h-[140px] overflow-y-auto pr-1">
                  {payerExpenses.length === 0 ? (
                    <div className="text-[10px] font-semibold text-text-muted/40 italic py-4 text-center">
                      Žádné zapsané platby
                    </div>
                  ) : (
                    payerExpenses.map(e => {
                      const styles = getCategoryStyles(e.category);
                      return (
                        <div 
                          key={e.id}
                          onClick={() => setSelectedExpense(e)}
                          className={`flex items-center justify-between p-2 rounded-xl border cursor-pointer hover:scale-[1.01] hover:shadow-sm active:scale-[0.99] transition-all duration-200 text-xs ${styles.bg}`}
                          title="Kliknutím zobrazíte detail platby"
                        >
                          <div className="min-w-0 pr-2">
                            <span 
                              className={`inline-block px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest mb-1 ${styles.badgeBg}`}
                            >
                              {e.category}
                            </span>
                            <p className="font-bold text-primary truncate leading-tight">
                              {e.description || e.category}
                            </p>
                          </div>
                          <span className={`font-black shrink-0 ${styles.text}`}>
                            {formatValue(e.amountInBase)} {getSymbol()}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Editable Settlement Table (Dlužná tabulka) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-xs font-bold uppercase tracking-widest text-text-muted flex items-center gap-1.5">
            <TrendingUp size={14} className="text-primary/70" /> Tabulka Vyrovnání
          </h3>
          <button 
            onClick={handleResetSplits}
            className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-primary hover:underline hover:opacity-80 transition-opacity"
            title="Resetovat rozdělení na rovnoměrné části"
          >
            <RotateCcw size={12} />
            Resetovat podíly
          </button>
        </div>

        {/* CSS for forcing standard columns on small landscape / viewport layouts */}
        <div className="bg-white rounded-3xl border border-bg-soft shadow-sm overflow-hidden">
          <div className="overflow-x-auto min-w-full">
            <table className="w-full text-left border-collapse min-w-[400px]">
              <thead>
                <tr className="border-b border-bg-soft bg-bg-soft/40">
                  <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-text-muted">Člen</th>
                  <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-text-muted text-right w-[140px]">Má zaplatit</th>
                  <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-text-muted text-right">Zrealizoval platy</th>
                  <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-text-muted text-center">Rozdíl</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bg-soft">
                {participantsList.map(p => {
                  const paid = paidPerParticipant[p.id] || 0;
                  const shouldPay = finalSharesInBase[p.id] || 0;
                  const diff = paid - shouldPay;
                  const isLocked = !!customSplits[p.id]?.isLocked;

                  return (
                    <tr key={p.id} className="hover:bg-bg-soft/10 transition-colors">
                      {/* Column 1: Avatar + Name */}
                      <td className="py-2.5 px-4">
                        <div className="flex items-center gap-2.5 min-w-0">
                          {p.photoURL ? (
                            <img 
                              src={p.photoURL} 
                              alt={p.name} 
                              className="w-7 h-7 rounded-full object-cover shrink-0 border"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <div className="w-7 h-7 rounded-full bg-primary/5 border border-primary/25 flex items-center justify-center text-primary font-bold text-xs shrink-0 select-none uppercase">
                              {p.initial}
                            </div>
                          )}
                          <span className="font-bold text-sm text-primary truncate max-w-[120px]">{p.name}</span>
                        </div>
                      </td>

                      {/* Column 2: Editable Amount */}
                      <td className="py-2.5 px-4 text-right">
                        <EditableShareInput
                          value={convertToActive(shouldPay)}
                          isLocked={isLocked}
                          onChange={(val) => handleEditShouldPay(p.id, val)}
                          currencySymbol={getSymbol()}
                        />
                      </td>

                      {/* Column 4: Paid Amount */}
                      <td className="py-2.5 px-4 text-right">
                        <span className="text-xs font-bold text-primary">
                          {formatValue(paid)} {getSymbol()}
                        </span>
                      </td>

                      {/* Column 5: Status pill / Difference */}
                      <td className="py-2.5 px-4 text-center">
                        {Math.abs(diff) < 1.0 ? (
                          <span className="inline-block bg-slate-50 border border-slate-200 text-slate-500 font-bold px-2.5 py-1 text-[10px] rounded-full uppercase tracking-wider">
                            Vyrovnáno
                          </span>
                        ) : diff > 0 ? (
                          <span className="inline-block bg-emerald-50 border border-emerald-100 text-emerald-700 font-black px-2.5 py-1 text-[10px] rounded-full uppercase tracking-wider">
                            Dostane {formatValue(diff)} {getSymbol()}
                          </span>
                        ) : (
                          <span className="inline-block bg-rose-50 border border-rose-100 text-rose-700 font-black px-2.5 py-1 text-[10px] rounded-full uppercase tracking-wider">
                            Dluží {formatValue(Math.abs(diff))} {getSymbol()}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Debt Transfers (Kdo má dát komu) */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-widest text-text-muted px-1 flex items-center gap-1.5">
          <DollarSign size={14} className="text-primary/70" /> Minimalizované vyrovnávací platby
        </h3>

        {settlementTransfers.length === 0 ? (
          <div className="bg-white border border-bg-soft rounded-3xl p-6 shadow-sm flex flex-col items-center justify-center text-center space-y-2">
            <div className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-500 flex items-center justify-center border border-emerald-100">
              <Check size={20} />
            </div>
            <p className="text-sm font-bold text-primary">Všechny účty jsou dokonale vyrovnány!</p>
            <p className="text-xs text-text-muted font-medium">Nikdo nemusí nikomu nic posílat.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {settlementTransfers.map((tx, idx) => {
              const paidFrom = paidPerParticipant[tx.from.id] || 0;
              const shouldPayFrom = finalSharesInBase[tx.from.id] || 0;
              const paidTo = paidPerParticipant[tx.to.id] || 0;
              const shouldPayTo = finalSharesInBase[tx.to.id] || 0;

              return (
                <div 
                  key={idx}
                  onClick={() => setSelectedTransfer({ tx, paidFrom, shouldPayFrom, paidTo, shouldPayTo })}
                  className="bg-white p-4.5 rounded-2xl border border-bg-soft shadow-sm hover:shadow-md hover:border-slate-350 cursor-pointer active:scale-[0.99] transition-all flex flex-row items-center justify-between gap-3 text-xs"
                  title="Kliknutím zobrazíte detailní matematický rozbor platby"
                >
                  {/* Debtor side with full name and wrapping word-break */}
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {tx.from.photoURL ? (
                      <img 
                        src={tx.from.photoURL} 
                        alt={tx.from.name} 
                        className="w-8 h-8 rounded-full border shrink-0 object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-rose-50 border border-rose-150 text-rose-700 flex items-center justify-center text-xs font-bold shrink-0 select-none uppercase">
                        {tx.from.initial}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-extrabold text-xs text-primary leading-tight break-words pr-1">{tx.from.name}</p>
                      <span className="text-[9px] font-bold text-rose-500 uppercase tracking-widest block">Pošle</span>
                    </div>
                  </div>

                  {/* Flow Direction Indicator & Price */}
                  <div className="flex flex-col items-center shrink-0 px-1 bg-slate-50 border border-slate-200/50 rounded-xl py-1">
                    <span className="text-[11px] font-black text-primary tracking-tight whitespace-nowrap">
                      {formatValue(tx.amountInBase)} {getSymbol()}
                    </span>
                    <ArrowRight size={11} className="text-text-muted/50 mt-0.5 animate-pulse" />
                  </div>

                  {/* Creditor side with full name and wrapping word-break */}
                  <div className="flex items-center gap-2 min-w-0 flex-1 justify-end text-right">
                    <div className="min-w-0 flex-1">
                      <p className="font-extrabold text-xs text-primary leading-tight break-words pl-1">{tx.to.name}</p>
                      <span className="text-[9px] font-bold text-emerald-500 uppercase tracking-widest block">Dostane</span>
                    </div>
                    {tx.to.photoURL ? (
                      <img 
                        src={tx.to.photoURL} 
                        alt={tx.to.name} 
                        className="w-8 h-8 rounded-full border shrink-0 object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-emerald-50 border border-emerald-150 text-emerald-700 flex items-center justify-center text-xs font-bold shrink-0 select-none uppercase">
                        {tx.to.initial}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* DETAIL MODALS (EXPENSE DETAIL & TRANSFER DETAIL BREAKDOWN) */}
      <AnimatePresence>
        {/* 1. EXPENSE DETAIL MODAL */}
        {selectedExpense && (
          <div 
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setSelectedExpense(null)}
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 15 }}
              transition={{ duration: 0.2 }}
              className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl border border-slate-100/80 flex flex-col relative"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header category-colored gradient band */}
              <div className={`h-2.5 w-full bg-primary/20 ${getCategoryStyles(selectedExpense.category).badgeBg}`} />

              <div className="p-6 space-y-5">
                {/* Header title */}
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <span className={`inline-block px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest mb-1.5 ${getCategoryStyles(selectedExpense.category).badgeBg}`}>
                      {selectedExpense.category}
                    </span>
                    <h4 className="text-base font-black text-primary leading-snug break-words">
                      {selectedExpense.description || selectedExpense.category}
                    </h4>
                  </div>
                  <button 
                    onClick={() => setSelectedExpense(null)}
                    className="p-1.5 rounded-full hover:bg-slate-100 text-text-muted hover:text-primary transition-colors cursor-pointer animate-none"
                  >
                    <X size={18} />
                  </button>
                </div>

                <hr className="border-bg-soft" />

                {/* Content grid */}
                <div className="grid grid-cols-1 gap-4 text-xs font-medium text-text-muted leading-relaxed">
                  <div className="flex items-center gap-3 bg-slate-50/50 p-3 rounded-xl border border-bg-soft/70">
                    <Coins className="text-primary/70 shrink-0" size={16} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-text-muted mb-0.5">Výše platby</p>
                      <p className="font-extrabold text-sm text-primary">
                        {selectedExpense.amount.toLocaleString('cs-CZ')} <span className="font-semibold">{selectedExpense.currency || trip.currency}</span>
                      </p>
                    </div>
                  </div>

                  {/* If original currency is different from trip currency/base, show converted details */}
                  {(selectedExpense.currency && selectedExpense.currency !== profile.baseCurrency) && (
                    <div className="flex items-center gap-3 bg-slate-50/50 p-3 rounded-xl border border-bg-soft/70">
                      <RefreshCw className="text-amber-600 shrink-0" size={16} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[9px] font-bold uppercase tracking-widest text-amber-700 mb-0.5">V domácí měně & kurz</p>
                        <p className="text-primary">
                          <span className="font-extrabold text-sm text-amber-700">
                            {selectedExpense.amountInBase.toLocaleString('cs-CZ')} {profile.baseCurrency}
                          </span>
                          <span className="text-[10px] ml-2 text-text-muted">
                            (Kurz: {selectedExpense.rate ? selectedExpense.rate.toFixed(4) : '?'} {profile.baseCurrency} za 1 {selectedExpense.currency})
                          </span>
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3.5">
                    <div className="bg-slate-50/50 p-3 rounded-xl border border-bg-soft/70">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-text-muted mb-1">Kdo platil</p>
                      <div className="flex items-center gap-2">
                        <User size={12} className="text-primary/60 shrink-0" />
                        <span className="font-bold text-xs text-primary leading-tight truncate">
                          {participantsList.find(pr => pr.id === (selectedExpense.paidBy || 'me'))?.name || selectedExpense.paidBy}
                        </span>
                      </div>
                    </div>

                    <div className="bg-slate-50/50 p-3 rounded-xl border border-bg-soft/70">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-text-muted mb-1">Datum platby</p>
                      <div className="flex items-center gap-2">
                        <Calendar size={12} className="text-primary/60 shrink-0" />
                        <span className="font-bold text-xs text-primary">
                          {new Date(selectedExpense.date).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric' })}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-slate-50/50 p-3 rounded-xl border border-bg-soft/70">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-text-muted mb-1">Týká se osob (za koho se platí)</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {(() => {
                        const affectedIds = selectedExpense.splitBetween && selectedExpense.splitBetween.length > 0
                          ? selectedExpense.splitBetween
                          : participantsList.map(p => p.id);
                        
                        return affectedIds.map(id => {
                          const name = participantsList.find(pr => pr.id === id)?.name || (id === 'me' ? (profile.displayName || 'Já') : id);
                          return (
                            <span key={id} className="bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded-lg text-xs font-bold">
                              {name}
                            </span>
                          );
                        });
                      })()}
                    </div>
                  </div>

                  <div className="bg-primary/5 border border-primary/10 p-3 rounded-xl flex items-start gap-2.5">
                    <Info size={14} className="text-primary mt-0.5 shrink-0" />
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-widest text-primary/80 mb-0.5">Podíl v tabulce vyrovnání</p>
                      <p className="text-[11px] leading-snug font-semibold text-primary/95">
                        Tato částka se v tabulce vykazuje jako částka ve výši <span className="font-black text-xs text-primary">{formatValue(selectedExpense.amountInBase)} {getSymbol()}</span> v měně výletu.
                      </p>
                    </div>
                  </div>
                </div>

                <button 
                  onClick={() => setSelectedExpense(null)}
                  className="w-full py-2.5 bg-primary text-white rounded-xl text-xs font-bold shadow-md hover:bg-primary/90 transition-all cursor-pointer text-center"
                >
                  Hotovo
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* 2. TRANSFER DETAIL BREAKDOWN MODAL */}
        {selectedTransfer && (
          <div 
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setSelectedTransfer(null)}
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 15 }}
              transition={{ duration: 0.2 }}
              className="bg-white rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl border border-slate-100 flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6 space-y-5">
                {/* Header */}
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <span className="inline-block px-2.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest text-emerald-800 bg-emerald-50 border border-emerald-100 mb-1.5">
                      Detaily Vyrovnání Platby
                    </span>
                    <h4 className="text-base font-black text-primary leading-snug">
                      Matematický rozbor dlužné platby
                    </h4>
                  </div>
                  <button 
                    onClick={() => setSelectedTransfer(null)}
                    className="p-1.5 rounded-full hover:bg-slate-100 text-text-muted hover:text-primary transition-colors cursor-pointer animate-none"
                  >
                    <X size={18} />
                  </button>
                </div>

                <hr className="border-bg-soft" />

                {/* Transfer visualisation card */}
                <div className="bg-slate-50/60 border border-bg-soft/85 p-4 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4">
                  {/* From participant */}
                  <div className="flex flex-col items-center text-center space-y-2 flex-1">
                    {selectedTransfer.tx.from.photoURL ? (
                      <img src={selectedTransfer.tx.from.photoURL} alt={selectedTransfer.tx.from.name} className="w-12 h-12 rounded-full border border-rose-200 object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-rose-50 border border-rose-150 text-rose-700 flex items-center justify-center text-sm font-black uppercase">
                        {selectedTransfer.tx.from.initial}
                      </div>
                    )}
                    <div>
                      <p className="font-extrabold text-xs text-primary leading-tight">{selectedTransfer.tx.from.name}</p>
                      <span className="text-[9px] font-bold text-rose-600 tracking-wider uppercase">Plátce dluhu</span>
                    </div>
                  </div>

                  {/* Flow price indicator */}
                  <div className="flex flex-col items-center justify-center text-center px-4 py-2 bg-white/95 border border-slate-150 rounded-xl shadow-xs">
                    <span className="text-sm font-black text-emerald-600 block">
                      {formatValue(selectedTransfer.tx.amountInBase)} {getSymbol()}
                    </span>
                    <ArrowRight size={14} className="text-emerald-500 animate-pulse mt-0.5" />
                  </div>

                  {/* To participant */}
                  <div className="flex flex-col items-center text-center space-y-2 flex-1">
                    {selectedTransfer.tx.to.photoURL ? (
                      <img src={selectedTransfer.tx.to.photoURL} alt={selectedTransfer.tx.to.name} className="w-12 h-12 rounded-full border border-emerald-200 object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-emerald-50 border border-emerald-150 text-emerald-700 flex items-center justify-center text-sm font-black uppercase">
                        {selectedTransfer.tx.to.initial}
                      </div>
                    )}
                    <div>
                      <p className="font-extrabold text-xs text-primary leading-tight">{selectedTransfer.tx.to.name}</p>
                      <span className="text-[9px] font-bold text-emerald-600 tracking-wider uppercase">Příjemce peněz</span>
                    </div>
                  </div>
                </div>

                {/* Math cards comparison side by side */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-semibold text-text-muted">
                  {/* From (Debtor) breakdown */}
                  <div className="border border-rose-100/80 bg-rose-50/20 p-4.5 rounded-2xl space-y-2">
                    <p className="text-[10px] uppercase font-black text-rose-700 tracking-widest">{selectedTransfer.tx.from.name}</p>
                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between">
                        <span>Zrealizoval platy:</span>
                        <span className="font-extrabold text-primary">{formatValue(selectedTransfer.paidFrom)} {getSymbol()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Odpovídající podíl:</span>
                        <span className="font-extrabold text-primary">{formatValue(selectedTransfer.shouldPayFrom)} {getSymbol()}</span>
                      </div>
                      <div className="border-t border-rose-100/50 pt-1 flex justify-between font-extrabold">
                        <span className="text-rose-700">Dluží skupině celkově:</span>
                        <span className="text-rose-700">{formatValue(selectedTransfer.shouldPayFrom - selectedTransfer.paidFrom)} {getSymbol()}</span>
                      </div>
                    </div>
                  </div>

                  {/* To (Creditor) breakdown */}
                  <div className="border border-emerald-100/80 bg-emerald-50/20 p-4.5 rounded-2xl space-y-2">
                    <p className="text-[10px] uppercase font-black text-emerald-700 tracking-widest">{selectedTransfer.tx.to.name}</p>
                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between">
                        <span>Zrealizoval platy:</span>
                        <span className="font-extrabold text-primary">{formatValue(selectedTransfer.paidTo)} {getSymbol()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Odpovídající podíl:</span>
                        <span className="font-extrabold text-primary">{formatValue(selectedTransfer.shouldPayTo)} {getSymbol()}</span>
                      </div>
                      <div className="border-t border-emerald-100/50 pt-1 flex justify-between font-extrabold">
                        <span className="text-emerald-700">Skupina mu dluží:</span>
                        <span className="text-emerald-700">{formatValue(selectedTransfer.paidTo - selectedTransfer.shouldPayTo)} {getSymbol()}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Plain text explanation */}
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-150">
                  <p className="text-[11px] leading-relaxed text-text-muted font-medium">
                    Člen <span className="font-bold text-primary">{selectedTransfer.tx.from.name}</span> zaplatil celkově o {formatValue(selectedTransfer.shouldPayFrom - selectedTransfer.paidFrom)} {getSymbol()} méně, než je jeho vypočtený podíl na výdajích.
                    Naopak <span className="font-bold text-primary">{selectedTransfer.tx.to.name}</span> utratil za ostatní o {formatValue(selectedTransfer.paidTo - selectedTransfer.shouldPayTo)} {getSymbol()} více, než je jeho adekvátní díl.
                    Odesláním vyrovnávací platby ve výši <span className="font-bold text-emerald-600">{formatValue(selectedTransfer.tx.amountInBase)} {getSymbol()}</span> dlužník přímo sníží svůj dluh a věřitel získá své finance zpět.
                  </p>
                </div>

                <button 
                  onClick={() => setSelectedTransfer(null)}
                  className="w-full py-2.5 bg-primary text-white rounded-xl text-xs font-bold shadow-md hover:bg-primary/95 transition-all cursor-pointer text-center"
                >
                  Zavřít detail
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Subcomponent to cleanly manage single text input states for each row and avoid focus interruptions
function EditableShareInput({ 
  value, 
  isLocked,
  onChange, 
  currencySymbol 
}: { 
  value: number; 
  isLocked: boolean;
  onChange: (val: number | null) => void; 
  currencySymbol: string 
}) {
  const [localVal, setLocalVal] = useState('');
  const isEditing = useRef(false);

  useEffect(() => {
    if (!isEditing.current) {
      if (value === 0) {
        setLocalVal('');
      } else {
        setLocalVal(value.toFixed(1).replace(/\.0$/, ''));
      }
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setLocalVal(val);
    if (val === '') {
      onChange(null);
    } else {
      const parsed = parseFloat(val);
      if (!isNaN(parsed)) {
        onChange(parsed);
      }
    }
  };

  const handleBlur = () => {
    isEditing.current = false;
    if (localVal === '') {
      onChange(null);
    } else {
      if (value === 0) {
        setLocalVal('');
      } else {
        setLocalVal(value.toFixed(1).replace(/\.0$/, ''));
      }
    }
  };

  return (
    <div className="relative flex items-center max-w-[125px] ml-auto">
      <input
        type="number"
        inputMode="decimal"
        step="any"
        value={localVal}
        placeholder={isLocked ? "0" : value.toFixed(0)}
        onChange={handleChange}
        onFocus={() => { isEditing.current = true; }}
        onBlur={handleBlur}
        className={`w-full text-right py-1.5 rounded-xl px-2.5 pr-8 text-xs font-extrabold focus:outline-none focus:ring-2 transition-all shadow-inner ${
          isLocked 
            ? 'bg-amber-50/80 hover:bg-amber-50 border border-amber-300 text-amber-900 focus:ring-amber-500 hover:border-amber-400' 
            : 'bg-bg-soft hover:bg-slate-50 border border-transparent hover:border-slate-200 text-primary focus:ring-primary'
        }`}
        title={isLocked ? "Uzamčený podíl. Vymažte hodnotu pro odemčení zpět na automatický propočet." : "Nastavit vlastní podíl"}
      />
      {/* If locked, show a tiny lock icon inside the input for immediate guidance */}
      {isLocked && (
        <div className="absolute left-2.5 flex items-center pointer-events-none text-amber-500/70" title="Uzamčeno">
          <Lock size={10} />
        </div>
      )}
      <span className={`absolute right-2.5 text-[9px] font-black select-none uppercase ${isLocked ? 'text-amber-700/80' : 'text-text-muted/65'}`}>
        {currencySymbol}
      </span>
    </div>
  );
}
