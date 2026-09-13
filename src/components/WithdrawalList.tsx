import { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, addDoc, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { Withdrawal, Trip, UserProfile } from '../types';
import { Minus, Plus, Save, Trash2, Landmark, X, Cloud, Coins } from 'lucide-react';
import { format, addDays, subDays } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { CURRENCIES } from '../services/currencyService';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface WithdrawalListProps {
  withdrawals: Withdrawal[];
  trip: Trip;
  profile: UserProfile;
  exchangeRates: Record<string, number> | null;
  isLoadingRates: boolean;
  onRefreshRates: () => Promise<void>;
}

export default function WithdrawalList({ 
  withdrawals, 
  trip, 
  profile,
  exchangeRates
}: WithdrawalListProps) {
  const [date, setDate] = useState(new Date());
  
  // 1. Částka (Withdrawn Cash Amount & Currency)
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(() => localStorage.getItem('lastUsedCurrency') || trip.currency);
  
  // 2. Strženo z účtu (Account Amount & Account Currency)
  const [accountAmount, setAccountAmount] = useState('');
  const [accountCurrency, setAccountCurrency] = useState(profile.baseCurrency);
  
  // 3. Částka v domovské měně (Base Currency Amount, shown only if accountCurrency !== profile.baseCurrency)
  const [amountInBase, setAmountInBase] = useState('');

  const [location, setLocation] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  
  const [currencySearch, setCurrencySearch] = useState(() => localStorage.getItem('lastUsedCurrency') || trip.currency);
  const [showCurrencyDropdown, setShowCurrencyDropdown] = useState(false);
  
  const [recentCurrencies, setRecentCurrencies] = useState<string[]>(() => {
    const saved = localStorage.getItem('recentCurrencies');
    return saved ? JSON.parse(saved) : [];
  });

  const isAccountInBase = accountCurrency.trim().toUpperCase() === profile.baseCurrency.trim().toUpperCase();

  // Reset/sync defaults when profile or trip changes
  useEffect(() => {
    if (!showForm) {
      const lastUsed = localStorage.getItem('lastUsedCurrency');
      const initialCurrency = lastUsed || trip.currency;
      setCurrency(initialCurrency);
      setCurrencySearch(initialCurrency);
      setAccountCurrency(profile.baseCurrency);
    }
  }, [trip.currency, profile.baseCurrency, showForm]);

  // Auto-calculate amountInBase if accountCurrency !== profile.baseCurrency
  useEffect(() => {
    const accCurr = accountCurrency.trim().toUpperCase();
    const baseCurr = profile.baseCurrency.trim().toUpperCase();

    if (accCurr === baseCurr) {
      setAmountInBase(accountAmount);
    } else if (accountAmount && !isNaN(Number(accountAmount))) {
      if (exchangeRates && exchangeRates[accCurr]) {
        const rateAccToBase = 1 / exchangeRates[accCurr];
        if (rateAccToBase > 0) {
          setAmountInBase((Number(accountAmount) * rateAccToBase).toFixed(2));
        }
      }
    }
  }, [accountAmount, accountCurrency, profile.baseCurrency, exchangeRates]);

  // Calculated effective cost in home currency (CZK)
  const calculatedCostInBase = isAccountInBase
    ? (accountAmount ? Number(accountAmount) : 0)
    : (amountInBase ? Number(amountInBase) : 0);

  // Filtered currencies for dropdown
  const filteredCurrencies = (() => {
    const search = currencySearch.toLowerCase().trim();
    const lastUsed = localStorage.getItem('lastUsedCurrency')?.toUpperCase();
    
    let matches = CURRENCIES.filter(c => 
      c.code.toLowerCase().includes(search) || 
      c.name.toLowerCase().includes(search) || 
      c.country.toLowerCase().includes(search)
    );

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
    }).slice(0, 8);
  })();

  // Editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    id?: string;
    amount?: number | string;
    currency?: string;
    accountAmount?: number | string;
    accountCurrency?: string;
    costInBase?: number | string;
    location?: string;
  }>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleSave = async () => {
    const amountNum = Number(amount);
    const accAmountNum = Number(accountAmount);
    
    if (!amount || isNaN(amountNum) || !accountAmount || isNaN(accAmountNum)) return;

    setIsSaving(true);
    const costInBaseNum = isAccountInBase ? accAmountNum : (Number(amountInBase) || 0);
    const rateNum = amountNum > 0 ? (costInBaseNum / amountNum) : 0;

    const withdrawal: Omit<Withdrawal, 'id'> = {
      tripId: trip.id,
      ownerId: trip.ownerId,
      date: date.toISOString(),
      amount: amountNum,
      currency: currency.toUpperCase(),
      accountAmount: accAmountNum,
      accountCurrency: accountCurrency.toUpperCase(),
      costInBase: costInBaseNum,
      baseCurrency: profile.baseCurrency.toUpperCase(),
      rate: rateNum,
      location: location.trim()
    };

    try {
      await addDoc(collection(db, 'withdrawals'), withdrawal);
      
      const upperCurrency = currency.toUpperCase();
      localStorage.setItem('lastUsedCurrency', upperCurrency);

      const updatedRecents = [upperCurrency, ...recentCurrencies.filter(c => c !== upperCurrency)].slice(0, 5);
      setRecentCurrencies(updatedRecents);
      localStorage.setItem('recentCurrencies', JSON.stringify(updatedRecents));

      setAmount('');
      setAccountAmount('');
      setAmountInBase('');
      setLocation('');
      setShowForm(false);
      setIsSaving(false);
    } catch (error) {
      setIsSaving(false);
      handleFirestoreError(error, OperationType.WRITE, 'withdrawals');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'withdrawals', id));
      setConfirmDeleteId(null);
      setEditingId(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `withdrawals/${id}`);
    }
  };

  const handleStartEdit = (w: Withdrawal) => {
    setEditingId(w.id);
    setEditForm({
      id: w.id,
      amount: w.amount,
      currency: w.currency,
      accountAmount: w.accountAmount ?? w.costInBase,
      accountCurrency: w.accountCurrency ?? w.baseCurrency ?? profile.baseCurrency,
      costInBase: w.costInBase,
      location: w.location || ''
    });
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editForm.amount || !editForm.accountAmount) return;

    const isEditAccountInBase = (editForm.accountCurrency || profile.baseCurrency).trim().toUpperCase() === profile.baseCurrency.trim().toUpperCase();
    const amountNum = Number(editForm.amount) || 0;
    const accAmountNum = Number(editForm.accountAmount) || 0;
    const costInBaseNum = isEditAccountInBase ? accAmountNum : (Number(editForm.costInBase) || 0);
    const rateNum = amountNum > 0 ? (costInBaseNum / amountNum) : 0;

    try {
      await updateDoc(doc(db, 'withdrawals', editingId), {
        amount: amountNum,
        currency: (editForm.currency || trip.currency).toUpperCase(),
        accountAmount: accAmountNum,
        accountCurrency: (editForm.accountCurrency || profile.baseCurrency).toUpperCase(),
        costInBase: costInBaseNum,
        baseCurrency: profile.baseCurrency.toUpperCase(),
        rate: rateNum,
        location: (editForm.location || '').trim()
      });
      setEditingId(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `withdrawals/${editingId}`);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <button
        onClick={() => setShowForm(!showForm)}
        className="w-full bg-white text-primary py-4 rounded-3xl font-medium shadow-sm flex items-center justify-center gap-2 border border-border-subtle hover:bg-bg-soft transition-all"
      >
        {showForm ? 'Zavřít formulář' : <><Plus size={20} /> Zaznamenat výběr</>}
      </button>

      {showForm && (
        <div className="bg-white p-4 sm:p-6 rounded-[28px] sm:rounded-[32px] shadow-sm space-y-4 border border-border-subtle">
          {/* Date */}
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold uppercase tracking-widest text-text-muted">Datum</label>
            <div className="flex items-center gap-3">
              <button onClick={() => setDate(subDays(date, 1))} className="p-2 rounded-full bg-bg-soft text-primary active:scale-95 transition-transform"><Minus size={16} /></button>
              <span className="font-bold text-primary">{format(date, 'd. M. yyyy')}</span>
              <button onClick={() => setDate(addDays(date, 1))} className="p-2 rounded-full bg-bg-soft text-primary active:scale-95 transition-transform"><Plus size={16} /></button>
            </div>
          </div>

          {/* 1. Částka (Amount & Currency) */}
          <div className="space-y-1">
            <label className="text-xs font-bold uppercase tracking-widest text-text-muted">Vybraná částka</label>
            <div className="flex gap-2 h-[56px] relative">
              <input
                type="number"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="flex-1 min-w-0 bg-bg-soft rounded-2xl px-4 focus:ring-2 focus:ring-primary text-lg font-bold text-primary"
              />
              <div className="relative w-28 sm:w-32 flex-shrink-0">
                <input
                  type="text"
                  value={currencySearch}
                  onFocus={() => {
                    setShowCurrencyDropdown(true);
                    setCurrencySearch('');
                  }}
                  onChange={(e) => {
                    setCurrencySearch(e.target.value);
                    setShowCurrencyDropdown(true);
                  }}
                  onBlur={() => {
                    setTimeout(() => {
                      setShowCurrencyDropdown(false);
                      setCurrencySearch(currency);
                    }, 200);
                  }}
                  placeholder="Měna"
                  className="w-full bg-bg-soft rounded-2xl px-3 h-full focus:ring-2 focus:ring-primary text-center font-extrabold uppercase text-primary text-base"
                />
                <AnimatePresence>
                  {showCurrencyDropdown && (
                    <motion.div 
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="absolute top-full right-0 w-64 mt-2 bg-white rounded-2xl shadow-xl border border-bg-soft z-50 overflow-hidden"
                    >
                      <div className="max-h-48 overflow-y-auto">
                        {filteredCurrencies.length > 0 ? (
                          filteredCurrencies.map(c => (
                            <button
                              key={c.code}
                              onClick={() => {
                                setCurrency(c.code);
                                setCurrencySearch(c.code);
                                setShowCurrencyDropdown(false);
                              }}
                              className={cn(
                                "w-full p-3 hover:bg-bg-soft flex items-center justify-between transition-colors border-b border-bg-soft last:border-none",
                                currency === c.code ? "bg-bg-soft text-primary font-bold" : "text-text-muted"
                              )}
                            >
                              <div className="flex flex-col items-start">
                                <span className="font-bold text-primary text-sm">{c.code}</span>
                                <span className="text-[10px] text-text-muted">{c.country}</span>
                              </div>
                              <span className="text-[10px] font-medium text-text-muted">{c.name}</span>
                            </button>
                          ))
                        ) : (
                          <div className="p-4 text-center text-xs text-text-muted italic">Měna nenalezena</div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Quick Currency Suggestions */}
            {!showCurrencyDropdown && (
              <div className="flex flex-wrap gap-1 mt-1 justify-center">
                {currency.toUpperCase() !== trip.currency.toUpperCase() && (
                  <button
                    onClick={() => {
                      setCurrency(trip.currency);
                      setCurrencySearch(trip.currency);
                    }}
                    className="text-[9px] font-bold px-2 py-0.5 bg-primary/10 text-primary rounded-md hover:bg-primary/20 transition-colors uppercase"
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
                      className="text-[9px] font-bold px-2 py-0.5 bg-bg-soft text-text-muted rounded-md hover:bg-bg-soft/80 transition-colors uppercase"
                    >
                      {c}
                    </button>
                  ))}
              </div>
            )}
          </div>

          {/* 2. Strženo z účtu (Account Amount & Account Currency) */}
          <div className="space-y-1">
            <label className="text-xs font-bold uppercase tracking-widest text-text-muted">Strženo z účtu</label>
            <div className="flex gap-2 h-[56px]">
              <input
                type="number"
                inputMode="decimal"
                value={accountAmount}
                onChange={(e) => setAccountAmount(e.target.value)}
                placeholder="0.00"
                className="flex-1 min-w-0 bg-bg-soft rounded-2xl px-4 focus:ring-2 focus:ring-primary font-bold text-primary text-base h-full"
              />
              <input
                type="text"
                value={accountCurrency}
                onChange={(e) => setAccountCurrency(e.target.value.toUpperCase())}
                placeholder="Měna"
                className="w-28 sm:w-32 flex-shrink-0 bg-bg-soft rounded-2xl px-3 focus:ring-2 focus:ring-primary text-center font-extrabold uppercase text-primary text-base h-full"
              />
            </div>
            
            {/* Quick buttons for account currency */}
            <div className="flex items-center gap-1.5 px-1 pt-1">
              <span className="text-[10px] text-text-muted font-bold">Rychlá měna účtu:</span>
              <button
                type="button"
                onClick={() => setAccountCurrency(profile.baseCurrency)}
                className={cn(
                  "text-[9px] font-bold px-2 py-0.5 rounded-md border transition-all",
                  accountCurrency.toUpperCase() === profile.baseCurrency.toUpperCase()
                    ? "bg-primary text-white border-primary"
                    : "bg-bg-soft text-text-muted border-border-subtle hover:bg-bg-soft/80"
                )}
              >
                {profile.baseCurrency} (Domovská)
              </button>
              {trip.currency.toUpperCase() !== profile.baseCurrency.toUpperCase() && (
                <button
                  type="button"
                  onClick={() => setAccountCurrency(trip.currency)}
                  className={cn(
                    "text-[9px] font-bold px-2 py-0.5 rounded-md border transition-all",
                    accountCurrency.toUpperCase() === trip.currency.toUpperCase()
                      ? "bg-primary text-white border-primary"
                      : "bg-bg-soft text-text-muted border-border-subtle hover:bg-bg-soft/80"
                  )}
                >
                  {trip.currency}
                </button>
              )}
            </div>
          </div>

          {/* 3. Conditional: Částka v domovské měně (Base Currency) if accountCurrency !== profile.baseCurrency */}
          {!isAccountInBase && (
            <div className="space-y-1 p-3.5 bg-amber-50/70 rounded-2xl border border-amber-200/80 animate-in fade-in duration-300">
              <div className="flex justify-between items-center px-0.5 mb-1">
                <label className="text-[11px] font-bold uppercase tracking-wider text-amber-950 flex items-center gap-1">
                  <Coins size={13} className="text-amber-700" />
                  Částka v domovské měně ({profile.baseCurrency})
                </label>
                <span className="text-[10px] text-amber-800 font-medium">Auto-přepočet z účtu</span>
              </div>
              <div className="flex gap-2">
                <input
                  type="number"
                  inputMode="decimal"
                  value={amountInBase}
                  onChange={(e) => setAmountInBase(e.target.value)}
                  placeholder="0.00"
                  className="flex-1 bg-white rounded-xl p-3 focus:ring-2 focus:ring-amber-500 font-bold text-amber-950 text-base border border-amber-200"
                />
                <div className="w-20 bg-amber-200/60 rounded-xl flex items-center justify-center font-extrabold text-amber-950 text-sm">
                  {profile.baseCurrency}
                </div>
              </div>
              <p className="text-[10px] text-amber-800 px-1 pt-1">
                Účet je v {accountCurrency}, vyčíslení pro statistiky se přepočítá na {profile.baseCurrency}.
              </p>
            </div>
          )}

          {/* Location */}
          <div className="space-y-1">
            <label className="text-xs font-bold uppercase tracking-widest text-text-muted">Místo / Bankomat</label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Např. AirBank, Letiště, Center..."
              className="w-full bg-bg-soft rounded-2xl p-4 focus:ring-2 focus:ring-primary text-sm font-medium"
            />
          </div>

          {/* Calculated Exchange Rate Info */}
          {amount && Number(amount) > 0 && calculatedCostInBase > 0 && (
            <div className="px-3 py-2 bg-bg-soft rounded-xl text-xs flex items-center justify-between text-text-muted font-medium">
              <span>Vypočtený kurz:</span>
              <span className="font-bold text-primary">
                1 {currency.toUpperCase()} = {(calculatedCostInBase / Number(amount)).toFixed(4)} {profile.baseCurrency}
              </span>
            </div>
          )}

          <button
            onClick={handleSave}
            disabled={isSaving || !amount || !accountAmount}
            className="w-full bg-primary text-primary-content py-4 rounded-full font-medium hover:bg-primary-dark transition-colors flex items-center justify-center gap-2 disabled:opacity-50 shadow-md active:scale-[0.98]"
          >
            {isSaving ? 'Ukládám...' : <><Save size={20} /> Uložit výběr</>}
          </button>
        </div>
      )}

      {/* Withdrawals List Table */}
      <div className="bg-white rounded-[32px] shadow-sm overflow-hidden border border-border-subtle">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[450px]">
            <thead>
              <tr className="bg-bg-soft border-b border-primary/10">
                <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-text-muted">Datum</th>
                <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-text-muted">Místo</th>
                <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-text-muted text-right">Vybráno</th>
                <th className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-text-muted text-right">Strženo</th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence initial={false}>
                {withdrawals.map((w) => {
                  const displayAccountCurrency = w.accountCurrency || w.baseCurrency || profile.baseCurrency;
                  const displayAccountAmount = w.accountAmount ?? w.costInBase;

                  return (
                    <motion.tr 
                      key={w.id} 
                      layout
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      transition={{ duration: 0.2 }}
                      onClick={() => handleStartEdit(w)}
                      className="border-b border-bg-soft hover:bg-bg-soft/70 transition-colors cursor-pointer"
                    >
                      <td className="px-4 py-4 text-sm text-primary">
                        <div className="flex items-center gap-1 font-medium">
                          {w._hasPendingWrites && <Cloud size={10} className="text-amber-500 animate-pulse" />}
                          {format(new Date(w.date), 'd. M.')}
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <Landmark size={14} className="text-text-muted shrink-0" />
                          <span className="font-bold text-primary text-sm truncate max-w-[120px]">
                            {w.location || 'Bankomat'}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <span className="font-serif font-bold text-primary text-base">
                          {w.amount} {w.currency}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <div className="flex flex-col items-end">
                          <span className="font-bold text-sm text-indigo-900">
                            {displayAccountAmount.toFixed(displayAccountAmount % 1 === 0 ? 0 : 2)} {displayAccountCurrency}
                          </span>
                          {displayAccountCurrency.toUpperCase() !== profile.baseCurrency.toUpperCase() && (
                            <span className="text-[10px] text-text-muted font-medium">
                              ({w.costInBase.toFixed(0)} {profile.baseCurrency})
                            </span>
                          )}
                        </div>
                      </td>
                    </motion.tr>
                  );
                })}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Modal */}
      {editingId && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 sm:p-6">
          <div className="absolute inset-0" onClick={() => setEditingId(null)} />
          <div className="bg-white w-full max-w-md rounded-[32px] p-6 sm:p-8 shadow-xl space-y-5 animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto relative z-10 border border-border-subtle">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-serif font-bold text-primary">Upravit výběr</h2>
              <button onClick={() => setEditingId(null)} className="p-2 text-text-muted hover:text-primary transition-colors"><X size={20} /></button>
            </div>

            <div className="space-y-4">
              {/* 1. Částka */}
              <div className="space-y-1">
                <label className="text-xs font-bold uppercase tracking-widest text-text-muted">Vybraná částka</label>
                <div className="flex gap-2 h-[52px]">
                  <input
                    type="number"
                    inputMode="decimal"
                    value={editForm.amount || ''}
                    onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })}
                    className="flex-1 min-w-0 bg-bg-soft rounded-2xl px-4 focus:ring-2 focus:ring-primary font-bold text-primary text-base h-full"
                  />
                  <input
                    type="text"
                    value={editForm.currency || ''}
                    onChange={(e) => setEditForm({ ...editForm, currency: e.target.value.toUpperCase() })}
                    className="w-28 sm:w-32 flex-shrink-0 bg-bg-soft rounded-2xl px-3 focus:ring-2 focus:ring-primary text-center font-extrabold uppercase text-primary text-base h-full"
                  />
                </div>
              </div>

              {/* 2. Strženo z účtu */}
              <div className="space-y-1">
                <label className="text-xs font-bold uppercase tracking-widest text-text-muted">Strženo z účtu</label>
                <div className="flex gap-2 h-[52px]">
                  <input
                    type="number"
                    inputMode="decimal"
                    value={editForm.accountAmount || ''}
                    onChange={(e) => setEditForm({ ...editForm, accountAmount: e.target.value })}
                    className="flex-1 min-w-0 bg-bg-soft rounded-2xl px-4 focus:ring-2 focus:ring-primary font-bold text-primary text-base h-full"
                  />
                  <input
                    type="text"
                    value={editForm.accountCurrency || ''}
                    onChange={(e) => setEditForm({ ...editForm, accountCurrency: e.target.value.toUpperCase() })}
                    className="w-28 sm:w-32 flex-shrink-0 bg-bg-soft rounded-2xl px-3 focus:ring-2 focus:ring-primary text-center font-extrabold uppercase text-primary text-base h-full"
                  />
                </div>
              </div>

              {/* 3. Conditional: Částka v domovské měně (if accountCurrency !== profile.baseCurrency) */}
              {(editForm.accountCurrency || profile.baseCurrency).trim().toUpperCase() !== profile.baseCurrency.trim().toUpperCase() && (
                <div className="space-y-1 p-3 bg-amber-50/70 rounded-2xl border border-amber-200">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-amber-950 block mb-1">
                    Částka v domovské měně ({profile.baseCurrency})
                  </label>
                  <div className="flex gap-2 h-[52px]">
                    <input
                      type="number"
                      inputMode="decimal"
                      value={editForm.costInBase || ''}
                      onChange={(e) => setEditForm({ ...editForm, costInBase: e.target.value })}
                      className="flex-1 min-w-0 bg-white rounded-xl px-4 focus:ring-2 focus:ring-amber-500 font-bold text-amber-950 border border-amber-200 text-base h-full"
                    />
                    <div className="w-28 sm:w-32 flex-shrink-0 bg-amber-200/60 rounded-xl flex items-center justify-center font-extrabold text-amber-950 text-base h-full">
                      {profile.baseCurrency}
                    </div>
                  </div>
                </div>
              )}

              {/* Místo */}
              <div className="space-y-1">
                <label className="text-xs font-bold uppercase tracking-widest text-text-muted">Místo / Bankomat</label>
                <input
                  type="text"
                  value={editForm.location || ''}
                  onChange={(e) => setEditForm({ ...editForm, location: e.target.value })}
                  placeholder="Bankomat..."
                  className="w-full bg-bg-soft rounded-2xl p-3.5 focus:ring-2 focus:ring-primary font-medium text-sm"
                />
              </div>
            </div>

            <button
              onClick={handleSaveEdit}
              className="w-full bg-primary text-primary-content py-4 rounded-full font-medium flex items-center justify-center gap-2 shadow-md active:scale-[0.98]"
            >
              <Save size={20} /> Uložit změny
            </button>

            <div className="pt-3 border-t border-bg-soft">
              {confirmDeleteId === editingId ? (
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-center font-bold text-red-500 uppercase tracking-widest">Opravdu smazat výběr?</p>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => handleDelete(editingId)}
                      className="flex-1 bg-red-500 text-white py-3 rounded-2xl font-bold text-sm shadow-md active:scale-[0.98]"
                    >
                      Ano, smazat
                    </button>
                    <button 
                      onClick={() => setConfirmDeleteId(null)}
                      className="flex-1 bg-bg-soft text-text-muted py-3 rounded-2xl font-bold text-sm"
                    >
                      Zrušit
                    </button>
                  </div>
                </div>
              ) : (
                <button 
                  onClick={() => setConfirmDeleteId(editingId)}
                  className="w-full flex items-center justify-center gap-2 text-red-500 font-bold p-2 hover:bg-red-50 transition-colors rounded-xl text-sm"
                >
                  <Trash2 size={16} /> Smazat výběr
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
