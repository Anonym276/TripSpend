import { useState, useEffect, useRef, useMemo } from 'react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, addDoc, doc, updateDoc } from 'firebase/firestore';
import { Withdrawal, Trip, UserProfile, Expense, Person } from '../types';
import { Minus, Plus, Save, Info, CheckCircle2, Calendar, RefreshCw, Loader2, Coins, ChevronDown, Users, Check } from 'lucide-react';
import { format, addDays, subDays } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { fetchSingleRate, CURRENCIES } from '../services/currencyService';

// Add custom cn utility just in case
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface ExpenseFormProps {
  trip: Trip;
  profile: UserProfile;
  withdrawals: Withdrawal[];
  exchangeRates: Record<string, number> | null;
  isLoadingRates: boolean;
  onRefreshRates: () => Promise<void>;
  people: Person[];
}

export default function ExpenseForm({ 
  trip, 
  profile, 
  withdrawals,
  exchangeRates,
  isLoadingRates,
  onRefreshRates,
  people
}: ExpenseFormProps) {
  const [date, setDate] = useState(new Date());
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(() => localStorage.getItem('lastUsedCurrency') || trip.currency);
  const [recipient, setRecipient] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState(profile.categories[0] || '');
  const [paymentMethod, setPaymentMethod] = useState<string>(() => localStorage.getItem('lastPaymentMethod') || 'CASH');
  const [amountInBaseInput, setAmountInBaseInput] = useState('');
  const [currencySearch, setCurrencySearch] = useState(() => localStorage.getItem('lastUsedCurrency') || trip.currency);
  const [showCurrencyDropdown, setShowCurrencyDropdown] = useState(false);
  const [recentCurrencies, setRecentCurrencies] = useState<string[]>(() => {
    const saved = localStorage.getItem('recentCurrencies');
    return saved ? JSON.parse(saved) : [];
  });
  
  // Calculate average rate from withdrawals
  const averageRate = (() => {
    if (withdrawals.length > 0) {
      return withdrawals.reduce((acc, w) => acc + w.rate, 0) / withdrawals.length;
    }
    if (exchangeRates && exchangeRates[currency.toUpperCase()]) {
      return 1 / exchangeRates[currency.toUpperCase()];
    }
    return trip.lastRate || 1;
  })();

  const [rate, setRate] = useState(averageRate);
  const [isSaving, setIsSaving] = useState(false);
  const [isFetchingRate, setIsFetchingRate] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [paidBy, setPaidBy] = useState<string>('me');
  const [showPayerDropdown, setShowPayerDropdown] = useState(false);
  const dateInputRef = useRef<HTMLInputElement>(null);

  // Group participants list (Owner 'me' + trip people)
  const allParticipants = useMemo(() => {
    const list = [
      { id: 'me', name: profile.displayName || 'Já' }
    ];
    if (trip.people) {
      people.filter(p => trip.people?.includes(p.id)).forEach(p => {
        list.push({ id: p.id, name: p.name });
      });
    }
    return list;
  }, [profile.displayName, trip.people, people]);

  const [splitBetween, setSplitBetween] = useState<string[]>(() => 
    allParticipants.map(p => p.id)
  );

  // Reset splitBetween when participant list changes
  useEffect(() => {
    setSplitBetween(allParticipants.map(p => p.id));
  }, [allParticipants]);

  // Auto-set rate logic
  useEffect(() => {
    if (!currency || !profile.baseCurrency) return;
    
    const curr = currency.toUpperCase();
    const base = profile.baseCurrency.toUpperCase();
    
    if (curr === base) {
      setRate(1);
      return;
    }

    const isTripCurrency = curr === trip.currency.toUpperCase();
    let targetRate = 0;

    if (isTripCurrency && withdrawals.length > 0) {
      // 1. If it's trip currency and we have withdrawals -> use average
      targetRate = withdrawals.reduce((acc, w) => acc + w.rate, 0) / withdrawals.length;
    } else if (exchangeRates && exchangeRates[curr]) {
      // 2. Otherwise (not trip currency OR no withdrawals) -> use market rate
      targetRate = 1 / exchangeRates[curr];
    } else {
      // 3. Fallback to last known rate
      targetRate = trip.lastRate || 1;
    }
    
    setRate(targetRate);
  }, [currency, profile.baseCurrency, exchangeRates, trip.currency, withdrawals]);

  const handleFetchRate = async () => {
    if (!currency || !profile.baseCurrency) return;
    
    const cleanAmount = amount.toString().replace(',', '.');
    const amountNum = Number(cleanAmount);
    let fetchedRate = 0;
    
    // 1. Use pre-fetched rates if available
    if (exchangeRates && exchangeRates[currency.toUpperCase()]) {
      fetchedRate = 1 / exchangeRates[currency.toUpperCase()];
    } else {
      setIsFetchingRate(true);
      try {
        const liveRate = await fetchSingleRate(currency, profile.baseCurrency);
        if (liveRate) {
          fetchedRate = liveRate;
        }
      } catch (err) {
        console.warn("Failed to fetch live rate offline:", err);
      } finally {
        setIsFetchingRate(false);
      }
    }

    // 2. Fallback if offline or fetching failed
    if (!fetchedRate) {
      fetchedRate = rate || averageRate || trip.lastRate || 1;
    }

    setRate(fetchedRate);

    // Update the base amount input automatically
    if (!isNaN(amountNum) && amountNum > 0) {
      setAmountInBaseInput((amountNum * fetchedRate).toFixed(2));
    }
  };

  // Update trip's last rate if it changed
  useEffect(() => {
    const lastUsed = localStorage.getItem('lastUsedCurrency');
    const initialCurrency = lastUsed || trip.currency;
    setCurrency(initialCurrency);
    setCurrencySearch(initialCurrency);
  }, [trip.currency]);

  // Filtered currencies for dropdown
  const filteredCurrencies = (() => {
    const search = currencySearch.toLowerCase().trim();
    const lastUsed = localStorage.getItem('lastUsedCurrency')?.toUpperCase();
    
    // Get all matching currencies
    let matches = CURRENCIES.filter(c => 
      c.code.toLowerCase().includes(search) || 
      c.name.toLowerCase().includes(search) || 
      c.country.toLowerCase().includes(search)
    );

    // Sort: Last Used > Trip currency > Recents > Others
    return matches.sort((a, b) => {
      if (lastUsed) {
        if (a.code === lastUsed && b.code !== lastUsed) return -1;
        if (a.code !== lastUsed && b.code === lastUsed) return 1;
      }

      const aIsTrip = a.code === trip.currency;
      const bIsTrip = b.code === trip.currency;
      if (aIsTrip && !bIsTrip) return -1;
      if (!aIsTrip && bIsTrip) return 1;

      const aRecentIndex = recentCurrencies.indexOf(a.code);
      const bRecentIndex = recentCurrencies.indexOf(b.code);
      
      if (aRecentIndex !== -1 && bRecentIndex === -1) return -1;
      if (aRecentIndex === -1 && bRecentIndex !== -1) return 1;
      if (aRecentIndex !== -1 && bRecentIndex !== -1) return aRecentIndex - bRecentIndex;

      return a.code.localeCompare(b.code);
    }).slice(0, 8); // Limit to 8 suggestions
  })();

  const handleSave = async () => {
    const cleanAmount = amount.toString().replace(',', '.');
    if (!cleanAmount || isNaN(Number(cleanAmount))) return;

    setIsSaving(true);
    const amountNum = Number(cleanAmount);
    
    let finalRate = rate;
    let finalAmountInBase = amountNum * rate;

    if (paymentMethod !== 'CASH') {
      const cleanBase = amountInBaseInput.toString().replace(',', '.');
      if (cleanBase && !isNaN(Number(cleanBase))) {
        finalAmountInBase = Number(cleanBase);
        finalRate = finalAmountInBase / amountNum;
      } else {
        // Fall back to rate-based calculation instead of setting to 0!
        finalAmountInBase = amountNum * rate;
        finalRate = rate;
      }
    }

    const userDisplayName = profile.displayName || profile.email.split('@')[0] || 'Uživatel';

    const getPaidByName = () => {
      if (paidBy === 'me') {
        return userDisplayName;
      }
      const matched = people.find(p => p.id === paidBy);
      return matched ? matched.name : 'Neznámý';
    };

    const expense: Omit<Expense, 'id'> = {
      tripId: trip.id,
      ownerId: profile.uid,
      date: date.toISOString(),
      amount: amountNum,
      currency: currency.toUpperCase(),
      recipient,
      description,
      category,
      paymentMethod,
      rate: finalRate,
      amountInBase: finalAmountInBase,
      createdBy: profile.uid,
      createdByName: userDisplayName,
      paidBy: paidBy === 'me' ? profile.uid : paidBy,
      paidByName: getPaidByName(),
      splitBetween: splitBetween
    };

    try {
      const currentPaymentMethod = paymentMethod;
      const currentCurrency = currency.toUpperCase();

      // Save last used payment method and currency
      localStorage.setItem('lastPaymentMethod', currentPaymentMethod);
      localStorage.setItem('lastUsedCurrency', currentCurrency);

      // Save to recent currencies
      const updatedRecents = [currentCurrency, ...recentCurrencies.filter(c => c !== currentCurrency)].slice(0, 5);
      setRecentCurrencies(updatedRecents);
      localStorage.setItem('recentCurrencies', JSON.stringify(updatedRecents));

      // Reset form immediately for outstanding offline UX - no blocking on Firestore sync!
      setAmount('');
      setAmountInBaseInput('');
      setRecipient('');
      setDescription('');
      setPaidBy('me');
      setSplitBetween(allParticipants.map(p => p.id));
      setIsSaving(false);
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 2000);

      // Save to Firestore in background (unawaited) so it goes into local cache/queue instantly
      addDoc(collection(db, 'expenses'), expense)
        .then(() => {
          // Update trip's last rate in background
          if (finalRate > 0 && finalRate !== trip.lastRate) {
            updateDoc(doc(db, 'trips', trip.id), { lastRate: finalRate }).catch(err => {
              console.warn("Failed to update trip lastRate (likely offline):", err);
            });
          }
        })
        .catch(err => {
          console.error("Delayed Firestore sync error:", err);
        });

    } catch (error) {
      setIsSaving(false);
      handleFirestoreError(error, OperationType.WRITE, 'expenses');
    }
  };

  return (
    <div className="space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="bg-white p-4 rounded-[32px] shadow-sm space-y-3">
        {/* Date */}
        <div className="flex items-center justify-between border-b border-bg-soft pb-2">
          <style dangerouslySetInnerHTML={{ __html: `
            .date-input-container input::-webkit-calendar-picker-indicator {
              position: absolute;
              top: 0;
              left: 0;
              right: 0;
              bottom: 0;
              width: 100%;
              height: 100%;
              cursor: pointer;
              opacity: 0;
            }
          `}} />
          <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted">Datum</label>
          <div className="flex items-center gap-1">
            <button 
              onClick={() => setDate(subDays(date, 1))}
              className="p-1.5 rounded-full bg-bg-soft text-primary active:scale-90 transition-transform"
              title="Předchozí den"
            >
              <Minus size={14} />
            </button>
            
            <div className="date-input-container relative flex items-center gap-1.5 px-3 py-1.5 rounded-xl hover:bg-bg-soft cursor-pointer transition-colors group active:scale-[0.98]">
              <Calendar size={14} className="text-primary/40 group-hover:text-primary/70 transition-colors" />
              <span className="text-sm font-bold text-primary whitespace-nowrap">
                {format(date, 'd. M. yyyy')}
              </span>
              <input
                ref={dateInputRef}
                type="date"
                value={format(date, 'yyyy-MM-dd')}
                onChange={(e) => {
                  if (e.target.value) {
                    const selectedDate = new Date(e.target.value);
                    // Ensure we keep the current time or set to noon to avoid timezone issues
                    selectedDate.setHours(12, 0, 0, 0);
                    setDate(selectedDate);
                  }
                }}
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10"
                style={{ colorScheme: 'light' }}
                onClick={(e) => {
                  // Fallback for browsers that don't trigger on click but support showPicker
                  try {
                    // @ts-ignore
                    if (typeof e.target.showPicker === 'function') {
                      // @ts-ignore
                      e.target.showPicker();
                    }
                  } catch (err) {}
                }}
              />
            </div>

            <button 
              onClick={() => setDate(addDays(date, 1))}
              className="p-1.5 rounded-full bg-bg-soft text-primary active:scale-90 transition-transform"
              title="Následující den"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>

        {/* Amount & Currency */}
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2 space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted px-1">Kolik</label>
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                const val = e.target.value.replace(',', '.');
                // Limit to digits and a single optional decimal point
                if (val === '' || /^[0-9]*\.?[0-9]*$/.test(val)) {
                  setAmount(val);
                }
              }}
              placeholder="0.00"
              className="w-full text-xl font-serif bg-bg-soft rounded-xl p-2.5 focus:ring-2 focus:ring-primary"
            />
            {amount && !isNaN(Number(amount)) && (
              <p className="text-[10px] text-text-muted px-1 font-bold">
                Stojí vás: <span className="text-primary">{(Number(amount) * rate).toFixed(2)} {profile.baseCurrency}</span>
              </p>
            )}
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted px-1">Měna</label>
            <div className="relative">
              <input
                type="text"
                value={currencySearch}
                onFocus={() => setShowCurrencyDropdown(true)}
                onChange={(e) => {
                  setCurrencySearch(e.target.value);
                  setCurrency(e.target.value.toUpperCase());
                  setShowCurrencyDropdown(true);
                }}
                placeholder="Měna/Země"
                className="w-full text-lg font-serif text-primary bg-bg-soft rounded-xl p-2.5 focus:ring-2 focus:ring-primary text-center uppercase font-bold"
              />
              
              <AnimatePresence>
                {showCurrencyDropdown && (currencySearch.length > 0 || filteredCurrencies.length > 0) && (
                  <>
                    <div 
                      className="fixed inset-0 z-30" 
                      onClick={() => setShowCurrencyDropdown(false)} 
                    />
                    <motion.div
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 5 }}
                      className="absolute left-0 right-0 mt-1 bg-white rounded-2xl shadow-xl border border-bg-soft z-40 overflow-hidden max-h-64 overflow-y-auto"
                    >
                      {filteredCurrencies.length > 0 ? (
                        filteredCurrencies.map((c) => (
                          <button
                            key={c.code}
                            onClick={() => {
                              setCurrency(c.code);
                              setCurrencySearch(c.code);
                              setShowCurrencyDropdown(false);
                            }}
                            className="w-full flex items-center justify-between p-3 hover:bg-bg-soft transition-colors border-b border-bg-soft last:border-none"
                          >
                            <div className="flex flex-col items-start">
                              <span className="font-bold text-primary text-sm">{c.code}</span>
                              <span className="text-[10px] text-text-muted">{c.country}</span>
                            </div>
                            <span className="text-[10px] font-medium text-text-muted">{c.name}</span>
                          </button>
                        ))
                      ) : (
                        <div className="p-4 text-center text-xs text-text-muted italic">
                          Měna nenalezena. Můžete zadat vlastní kód.
                        </div>
                      )}
                    </motion.div>
                  </>
                )}
              </AnimatePresence>

              {/* Quick Suggestions (Recents & Trip) */}
              {!showCurrencyDropdown && (
                <div className="flex flex-wrap gap-1 mt-1 justify-center">
                  {currency.toUpperCase() !== trip.currency.toUpperCase() && (
                    <button
                      onClick={() => {
                        setCurrency(trip.currency);
                        setCurrencySearch(trip.currency);
                      }}
                      className="text-[8px] font-bold px-1.5 py-0.5 bg-primary/10 text-primary rounded-md hover:bg-primary/20 transition-colors uppercase"
                    >
                      {trip.currency}
                    </button>
                  )}
                  {recentCurrencies
                    .filter(c => c !== currency.toUpperCase() && c !== trip.currency.toUpperCase())
                    .slice(0, 3)
                    .map(c => (
                      <button
                        key={c}
                        onClick={() => {
                          setCurrency(c);
                          setCurrencySearch(c);
                        }}
                        className="text-[8px] font-bold px-1.5 py-0.5 bg-bg-soft text-text-muted rounded-md hover:bg-bg-soft/80 transition-colors uppercase"
                      >
                        {c}
                      </button>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Recipient & Description */}
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted px-1">Komu</label>
            <input
              type="text"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="Obchod..."
              className="w-full bg-bg-soft border-none rounded-xl p-2.5 text-sm focus:ring-2 focus:ring-primary"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted px-1">Popis</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Oběd..."
              className="w-full bg-bg-soft border-none rounded-xl p-2.5 text-sm focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>

        {/* Category & Payment Method */}
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted px-1">Kategorie</label>
            <div className="relative">
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full bg-bg-soft rounded-xl p-2.5 pr-8 text-sm focus:ring-2 focus:ring-primary appearance-none font-medium text-primary cursor-pointer"
              >
                {profile.categories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
              <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-text-muted/60" />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted px-1">Jak</label>
            <div className="relative">
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="w-full bg-bg-soft rounded-xl p-2.5 pr-8 text-sm focus:ring-2 focus:ring-primary appearance-none font-medium text-primary cursor-pointer"
              >
                {Array.from(new Set(['CASH', ...(profile.paymentMethods || ['KARTA'])])).map(method => (
                  <option key={method} value={method}>{method}</option>
                ))}
              </select>
              <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-text-muted/60" />
            </div>
          </div>
        </div>

        {/* Card Payment Amount in Base */}
        {paymentMethod !== 'CASH' && (
          <div className="space-y-1 pt-2 border-t border-bg-soft animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="flex justify-between items-center px-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted">
                Částka v domovské měně ({profile.baseCurrency})
              </label>
              <button 
                onClick={handleFetchRate}
                disabled={isFetchingRate || isLoadingRates}
                className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-primary hover:underline disabled:opacity-50"
              >
                {isFetchingRate || isLoadingRates ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
                <span>Aktuální kurz</span>
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                inputMode="decimal"
                value={amountInBaseInput}
                onChange={(e) => {
                  const val = e.target.value.replace(',', '.');
                  // Limit to digits and a single optional decimal point
                  if (val === '' || /^[0-9]*\.?[0-9]*$/.test(val)) {
                    setAmountInBaseInput(val);
                  }
                }}
                placeholder="0.00"
                className="flex-1 bg-bg-soft rounded-xl p-2.5 text-lg font-serif focus:ring-2 focus:ring-primary"
              />
              {amount && amountInBaseInput && !isNaN(Number(amount)) && !isNaN(Number(amountInBaseInput)) && (
                <div className="text-right leading-tight">
                  <span className="text-[9px] text-text-muted block uppercase font-bold">Vypočtený kurz</span>
                  <span className="font-bold text-primary text-xs">
                    {(Number(amountInBaseInput) / Number(amount)).toFixed(4)}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Who Paid & Exchange Rate on the same level */}
        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-bg-soft">
          {/* Who Paid Column */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted px-1 flex items-center gap-1">
              <Coins size={12} className="text-primary/70" /> Kdo zaplatil?
            </label>
            <div className="relative">
              <select
                value={paidBy}
                onChange={(e) => setPaidBy(e.target.value)}
                className="w-full bg-bg-soft rounded-xl p-2.5 pr-8 text-sm focus:ring-2 focus:ring-primary appearance-none font-medium text-primary cursor-pointer truncate"
              >
                <option value="me">Já</option>
                {trip.people && people.filter(p => trip.people?.includes(p.id)).map(person => (
                  <option key={person.id} value={person.id}>{person.name}</option>
                ))}
              </select>
              <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-text-muted/60" />
            </div>
          </div>

          {/* Rate Column */}
          <div className={`space-y-1 ${paymentMethod !== 'CASH' ? 'opacity-50' : ''}`}>
            <div className="flex justify-between items-center px-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted">
                {paymentMethod === 'CASH' ? `Kurz (${currency})` : 'Info kurz'}
              </label>
              {paymentMethod === 'CASH' && (
                <button 
                  onClick={handleFetchRate}
                  disabled={isFetchingRate || isLoadingRates}
                  className="flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-widest text-primary hover:underline disabled:opacity-50"
                  title="Obnovit aktuální kurz"
                >
                  {isFetchingRate || isLoadingRates ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
                </button>
              )}
            </div>
            <input
              type="text"
              inputMode="decimal"
              value={rate || ''}
              onChange={(e) => {
                const val = e.target.value.replace(',', '.');
                if (val === '' || /^[0-9]*\.?[0-9]*$/.test(val)) {
                  setRate(val === '' ? 0 : Number(val));
                }
              }}
              disabled={paymentMethod !== 'CASH'}
              className="w-full bg-bg-soft rounded-xl p-2.5 text-sm font-medium focus:ring-2 focus:ring-primary disabled:opacity-50"
            />
          </div>
        </div>

        {/* Affected Participants / Split Between Section */}
        {(profile.showGroupSection || allParticipants.length > 1) && (
          <div className="space-y-1.5 pt-2 border-t border-bg-soft">
            <div className="flex items-center justify-between px-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted flex items-center gap-1">
                <Users size={12} className="text-primary/70" /> Koho se týká (za koho platí):
              </label>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setSplitBetween(allParticipants.map(p => p.id))}
                  className="text-[9px] font-bold uppercase tracking-widest text-primary hover:underline cursor-pointer"
                >
                  Všichni
                </button>
                <span className="text-text-muted text-[9px]">•</span>
                <button
                  type="button"
                  onClick={() => setSplitBetween(['me'])}
                  className="text-[9px] font-bold uppercase tracking-widest text-primary hover:underline cursor-pointer"
                >
                  Jen já
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {allParticipants.map(p => {
                const isSelected = splitBetween.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      if (isSelected) {
                        if (splitBetween.length > 1) {
                          setSplitBetween(splitBetween.filter(id => id !== p.id));
                        }
                      } else {
                        setSplitBetween([...splitBetween, p.id]);
                      }
                    }}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer active:scale-95",
                      isSelected
                        ? "bg-primary/10 border-primary text-primary"
                        : "bg-bg-soft border-border-subtle text-text-muted opacity-60 hover:opacity-100"
                    )}
                  >
                    <div className={cn(
                      "w-4 h-4 rounded-md border flex items-center justify-center text-[10px]",
                      isSelected ? "bg-primary text-white border-primary" : "border-text-muted/40"
                    )}>
                      {isSelected && <Check size={10} />}
                    </div>
                    <span>{p.name}</span>
                  </button>
                );
              })}
            </div>

            {splitBetween.length < allParticipants.length && (
              <p className="text-[10px] text-amber-600 px-1 font-medium italic">
                * Útrata se v rozpočtu skupiny rozpočítá pouze mezi vybrané ({splitBetween.length} ze {allParticipants.length}).
              </p>
            )}
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={isSaving || !amount}
          className={`w-full text-primary-content py-3 rounded-2xl font-medium transition-all flex items-center justify-center gap-2 disabled:opacity-50 shadow-md active:scale-[0.98] ${
            showSuccess ? 'bg-green-600' : 'bg-primary hover:bg-primary-dark'
          }`}
        >
          <AnimatePresence mode="wait">
            {showSuccess ? (
              <motion.div
                key="success"
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.5 }}
                className="flex items-center gap-2"
              >
                <CheckCircle2 size={18} /> Přidáno!
              </motion.div>
            ) : (
              <motion.div
                key="save"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-2"
              >
                {isSaving ? 'Ukládám...' : <><Save size={16} /> Uložit útratu</>}
              </motion.div>
            )}
          </AnimatePresence>
        </button>
      </div>
    </div>
  );
}
