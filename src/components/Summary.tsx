import { useState, useEffect } from 'react';
import { Expense, Withdrawal, Trip, UserProfile } from '../types';
import { PieChart, Wallet, CreditCard, Banknote, TrendingUp, Sparkles, BarChart3, ArrowRightLeft, Info, Loader2, Users } from 'lucide-react';
import { PieChart as RePieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts';
import { GoogleGenAI } from "@google/genai";
import ReactMarkdown from 'react-markdown';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import * as XLSX from 'xlsx';
import { Download } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { getDisplayPaidByName } from '../services/dateUtils';

interface SummaryProps {
  expenses: Expense[];
  withdrawals: Withdrawal[];
  trip: Trip;
  profile: UserProfile;
  allTrips: Trip[];
  exchangeRates: Record<string, number> | null;
}

const COLORS = [
  '#FF3B30', // Red
  '#FF9500', // Orange
  '#FFCC00', // Yellow
  '#4CD964', // Green
  '#5AC8FA', // Light Blue
  '#007AFF', // Blue
  '#5856D6', // Indigo
  '#AF52DE', // Purple
  '#FF2D55', // Pink
  '#8E8E93'  // Gray
];

export default function Summary({ expenses, withdrawals, trip, profile, allTrips, exchangeRates }: SummaryProps) {
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [compareTripId, setCompareTripId] = useState<string>('');
  const [compareData, setCompareData] = useState<{ 
    name: string; 
    total: number; 
    daily: number; 
    categories: Record<string, number> 
  }[]>([]);
  const [viewType, setViewType] = useState<'current' | 'all'>('current');
  const [allExpenses, setAllExpenses] = useState<Expense[]>([]);
  const [isLoadingAll, setIsLoadingAll] = useState(false);

  useEffect(() => {
    if (viewType === 'all' && allExpenses.length === 0) {
      fetchAllExpenses();
    }
  }, [viewType]);

  const fetchAllExpenses = async () => {
    setIsLoadingAll(true);
    try {
      const q = query(collection(db, 'expenses'), where('ownerId', '==', profile.uid));
      const querySnapshot = await getDocs(q);
      setAllExpenses(querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Expense)));
    } catch (error) {
      console.error("Fetch All Error:", error);
    } finally {
      setIsLoadingAll(false);
    }
  };

  const currentExpenses = viewType === 'current' ? expenses : allExpenses;
  const totalInBase = currentExpenses.reduce((sum, e) => sum + e.amountInBase, 0);
  const pendingExpenses = currentExpenses.filter(e => e.amountInBase === 0);
  
  const cashExpenses = currentExpenses
    .filter(e => e.paymentMethod === 'CASH')
    .reduce((sum, e) => sum + e.amountInBase, 0);
  const cardExpenses = currentExpenses.filter(e => e.paymentMethod !== 'CASH').reduce((sum, e) => sum + e.amountInBase, 0);
  
  // Calculate display rate for the trip currency
  const tripCurrencyRates = withdrawals.filter(w => (w.currency || trip.currency) === trip.currency);
  let displayRate = 0;
  
  if (tripCurrencyRates.length > 0) {
    displayRate = tripCurrencyRates.reduce((sum, w) => sum + w.rate, 0) / tripCurrencyRates.length;
  } else if (exchangeRates && exchangeRates[trip.currency.toUpperCase()]) {
    // Fallback to global exchange rates (inverse because exchangeRates is base -> target)
    displayRate = 1 / exchangeRates[trip.currency.toUpperCase()];
  } else if (trip.lastRate) {
    displayRate = trip.lastRate;
  }

  const totalInTripCurrency = displayRate > 0 ? totalInBase / displayRate : 0;

  // Cash status only makes sense for current trip
  const currentTripCashExpenses = expenses
    .filter(e => e.paymentMethod === 'CASH' && e.currency === trip.currency)
    .reduce((sum, e) => sum + e.amount, 0);
  const totalWithdrawn = withdrawals
    .filter(w => (w.currency || trip.currency) === trip.currency)
    .reduce((sum, w) => sum + w.amount, 0);
  const cashRemaining = totalWithdrawn - currentTripCashExpenses;

  const categoryTotals = currentExpenses.reduce((acc, e) => {
    acc[e.category] = (acc[e.category] || 0) + e.amountInBase;
    return acc;
  }, {} as Record<string, number>);

  const sortedCategories = Object.entries(categoryTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value], index) => ({ 
      name, 
      value,
      fill: COLORS[index % COLORS.length]
    }));

  const pieData = sortedCategories;

  const totalsPerUser = currentExpenses.reduce((acc, e) => {
    const userName = getDisplayPaidByName(e, profile.uid, []);
    acc[userName] = (acc[userName] || 0) + e.amountInBase;
    return acc;
  }, {} as Record<string, number>);

  const sortedUserTotals = Object.entries(totalsPerUser)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value], index) => ({
      name,
      value,
      fill: COLORS[index % COLORS.length]
    }));

  const generateAiSummary = async () => {
    if (!profile.uid) return;
    setIsGenerating(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      const model = "gemini-3-flash-preview";
      
      const isShared = (trip.collaborators && trip.collaborators.length > 0) || trip.ownerId !== profile.uid;
      const effectiveAdults = isShared ? Math.max(trip.adults || 0, 2) : (trip.adults || 2);
      
      const expenseSummary = expenses.map(e => `${e.amount} ${e.currency} (${e.category}): ${e.description}`).join('\n');
      const prompt = `Jsi cestovní finanční poradce. Tady je seznam mých výdajů z výletu do ${trip.name}. 
      Výletu se účastní ${effectiveAdults} dospělí a ${trip.children || 0} dětí.
      Celkem jsem utratil ${totalInBase.toFixed(0)} ${profile.baseCurrency}.
      Výdaje:
      ${expenseSummary}
      
      Udělej mi krátké, vtipné a užitečné shrnutí mého utrácení v češtině. Zohledni počet osob při hodnocení nákladů (např. průměr na osobu). Co dělám dobře? Kde bych mohl ušetřit? Použij odrážky.`;

      const response = await ai.models.generateContent({
        model,
        contents: prompt,
      });
      setAiSummary(response.text || "Nepodařilo se vygenerovat shrnutí.");
    } catch (error) {
      console.error("AI Error:", error);
      setAiSummary("Chyba při generování AI shrnutí.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCompare = async (otherTripId: string) => {
    setCompareTripId(otherTripId);
    if (!otherTripId) {
      setCompareData([]);
      return;
    }

    const otherTrip = allTrips.find(t => t.id === otherTripId);
    if (!otherTrip) return;

    try {
      const q = query(
        collection(db, 'expenses'), 
        where('tripId', '==', otherTripId),
        where('ownerId', '==', profile.uid)
      );
      const querySnapshot = await getDocs(q);
      const otherExpenses = querySnapshot.docs.map(doc => doc.data() as Expense);
      const otherTotal = otherExpenses.reduce((sum, e) => sum + e.amountInBase, 0);
      
      const otherCategoryTotals = otherExpenses.reduce((acc, e) => {
        acc[e.category] = (acc[e.category] || 0) + e.amountInBase;
        return acc;
      }, {} as Record<string, number>);

      setCompareData([
        { 
          name: trip.name, 
          total: totalInBase, 
          daily: trip.duration ? totalInBase / trip.duration : 0,
          categories: categoryTotals
        },
        { 
          name: otherTrip.name, 
          total: otherTotal, 
          daily: otherTrip.duration ? otherTotal / otherTrip.duration : 0,
          categories: otherCategoryTotals
        }
      ]);
    } catch (error) {
      console.error("Compare Error:", error);
    }
  };

  const handleExport = () => {
    const dataToExport = currentExpenses.map(e => ({
      'Datum': new Date(e.date).toLocaleDateString('cs-CZ'),
      'Popis': e.description,
      'Kategorie': e.category,
      'Částka': e.amount,
      'Měna': e.currency,
      'Částka v CZK': e.amountInBase,
      'Metoda': e.paymentMethod,
      'Příjemce': e.recipient || '-',
      'Trip': allTrips.find(t => t.id === e.tripId)?.name || 'Neznámý'
    }));

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Výdaje");
    
    const fileName = viewType === 'current' 
      ? `Vydaje_${trip.name.replace(/\s+/g, '_')}.xlsx`
      : `Vydaje_Vsechny_Vylety.xlsx`;
      
    XLSX.writeFile(wb, fileName);
  };

  return (
    <div className="space-y-6 pb-20">
      {/* View Toggle */}
      <motion.div 
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex bg-bg-soft p-1 rounded-2xl"
      >
        <button 
          onClick={() => setViewType('current')}
          className={`flex-1 py-2 text-xs font-bold uppercase tracking-widest rounded-xl transition-all ${viewType === 'current' ? 'bg-white text-primary shadow-sm' : 'text-text-muted'}`}
        >
          Tento výlet
        </button>
        <button 
          onClick={() => setViewType('all')}
          className={`flex-1 py-2 text-xs font-bold uppercase tracking-widest rounded-xl transition-all ${viewType === 'all' ? 'bg-white text-primary shadow-sm' : 'text-text-muted'}`}
        >
          Všechny výlety
        </button>
      </motion.div>

      {/* Main Stats */}
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4 }}
        className="bg-primary p-8 rounded-[40px] text-primary-content shadow-lg relative overflow-hidden"
      >
        <div className="relative z-10">
          <div className="flex justify-between items-start mb-2">
            <p className="text-xs font-bold uppercase tracking-[0.2em] opacity-60">
              {viewType === 'current' ? 'Celková útrata' : 'Celkem za všechny výlety'}
            </p>
            <button 
              onClick={handleExport}
              className="p-2 bg-white/10 hover:bg-white/20 rounded-xl transition-colors"
              title="Exportovat do Excelu"
            >
              <Download size={18} />
            </button>
          </div>
          <h2 className="text-5xl font-serif mb-1">
            {isLoadingAll ? '...' : totalInBase.toFixed(0)} <span className="text-2xl opacity-60">{profile.baseCurrency}</span>
          </h2>
          {pendingExpenses.length > 0 && (
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-amber-300 mt-1 mb-2">
              <Info size={12} />
              <span>{pendingExpenses.length} {pendingExpenses.length === 1 ? 'útrata čeká' : (pendingExpenses.length < 5 ? 'útraty čekají' : 'útrat čeká')} na zaúčtování</span>
            </div>
          )}
          {viewType === 'current' && (
            <div className="flex flex-wrap gap-4 mb-6">
              <p className="text-sm font-medium opacity-80">
                ≈ {totalInTripCurrency.toLocaleString('cs-CZ', { maximumFractionDigits: 0 })} {trip.currency}
              </p>
              {trip.duration && (
                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest bg-white/10 px-2 py-1 rounded-lg">
                  <span>Průměrně: {(totalInBase / trip.duration).toFixed(0)} {profile.baseCurrency} / den</span>
                </div>
              )}
              {(() => {
                const isShared = (trip.collaborators && trip.collaborators.length > 0) || trip.ownerId !== profile.uid;
                const currentTotalPeople = (trip.adults || 0) + (trip.children || 0);
                const divisor = isShared ? Math.max(currentTotalPeople, 2) : (currentTotalPeople || 2);
                const showPerPersonBadge = isShared || currentTotalPeople > 0;
                if (!showPerPersonBadge) return null;
                return (
                  <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest bg-white/10 px-2 py-1 rounded-lg">
                    <span className="flex items-center gap-1">
                      <Users size={10} /> na osobu: {(totalInBase / divisor).toFixed(0)} {profile.baseCurrency}
                    </span>
                  </div>
                );
              })()}
            </div>
          )}
          {viewType === 'all' && <div className="mb-6" />}
          
          <div className="grid grid-cols-2 gap-6 pt-6 border-t border-white/10">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest opacity-60 mb-1">Kartou</p>
              <p className="text-xl font-serif">{isLoadingAll ? '...' : cardExpenses.toFixed(0)} {profile.baseCurrency}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest opacity-60 mb-1">Hotově</p>
              <p className="text-xl font-serif">{isLoadingAll ? '...' : cashExpenses.toFixed(0)} {profile.baseCurrency}</p>
            </div>
          </div>
        </div>
        <div className="absolute top-[-20%] right-[-10%] w-64 h-64 bg-white/5 rounded-full blur-3xl" />
      </motion.div>

      {/* AI Summary (Only for current trip) */}
      <AnimatePresence mode="wait">
        {viewType === 'current' && (
          <motion.div 
            key="ai-summary"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="bg-white p-6 rounded-[32px] shadow-sm border border-bg-soft"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <Sparkles className="text-[#F27D26]" size={20} />
                <h3 className="font-bold text-primary">AI Analýza</h3>
              </div>
              <button 
                onClick={generateAiSummary}
                disabled={isGenerating}
                className="text-[10px] font-bold uppercase tracking-widest text-primary hover:underline disabled:opacity-50"
              >
                {isGenerating ? 'Generuji...' : aiSummary ? 'Zkusit znovu' : 'Analyzovat výdaje'}
              </button>
            </div>
            {aiSummary ? (
              <div className="prose prose-sm max-w-none text-primary text-sm leading-relaxed">
                <ReactMarkdown>{aiSummary}</ReactMarkdown>
              </div>
            ) : (
              <p className="text-sm text-text-muted italic">
                Klikni na tlačítko výše a nech AI zhodnotit tvé utrácení na tomto výletě.
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Cash Status (Only for current trip) */}
        {viewType === 'current' && (
          <div className="bg-white p-6 rounded-[32px] shadow-sm">
            <div className="flex items-center gap-3 mb-4">
              <Wallet className="text-primary" />
              <h3 className="font-bold text-primary">Stav hotovosti</h3>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-text-muted">Vybráno celkem</span>
                <span className="font-medium">{totalWithdrawn} {trip.currency}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-text-muted">Utraceno v hotovosti</span>
                <span className="font-medium">{currentTripCashExpenses} {trip.currency}</span>
              </div>
              <div className="pt-3 border-t border-bg-soft flex justify-between items-center">
                <span className="font-bold text-primary">Zbývá v peněžence</span>
                <span className={`text-xl font-serif ${cashRemaining < 0 ? 'text-red-500' : 'text-primary'}`}>
                  {cashRemaining.toFixed(0)} {trip.currency}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Daily Average Card (Only for current trip) */}
        {viewType === 'current' && trip.duration && (
          <div className="bg-white p-6 rounded-[32px] shadow-sm border border-bg-soft">
            <div className="flex items-center gap-3 mb-4">
              <TrendingUp className="text-primary" />
              <h3 className="font-bold text-primary">Denní průměr</h3>
            </div>
            <div className="space-y-4">
              <div className="text-center py-2">
                <p className="text-3xl font-serif text-primary">
                  {(totalInBase / trip.duration).toFixed(0)} <span className="text-sm opacity-60">{profile.baseCurrency}</span>
                </p>
                <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted mt-1">za jeden den</p>
              </div>
              <div className="grid grid-cols-2 gap-4 pt-4 border-t border-bg-soft">
                <div className="text-center">
                  <p className="text-sm font-bold text-primary">{trip.duration}</p>
                  <p className="text-[8px] font-bold uppercase tracking-widest text-text-muted">Délka (dny)</p>
                </div>
                <div className="text-center">
                  <p className="text-sm font-bold text-primary">{(totalInBase / (trip.duration || 1)).toFixed(0)}</p>
                  <p className="text-[8px] font-bold uppercase tracking-widest text-text-muted">Rozpočet/den</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Expenses by Person - Shared context */}
        {viewType === 'current' && Object.keys(totalsPerUser).length > 0 && (
          <div className="bg-white p-6 rounded-[32px] shadow-sm flex flex-col h-full border border-bg-soft col-span-1 md:col-span-2">
            <div className="flex items-center gap-3 mb-4">
              <Users className="text-primary" />
              <h3 className="font-bold text-primary">Kdo kolik zaplatil</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {sortedUserTotals.map((user) => (
                <div key={user.name} className="bg-bg-soft/50 p-4 rounded-2xl flex flex-col justify-between border border-primary/5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-bold text-primary text-sm truncate pr-2">{user.name}</span>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 bg-primary/10 text-primary rounded-md">
                      {((user.value / totalInBase) * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-lg font-serif font-bold text-primary">
                      {user.value.toLocaleString('cs-CZ', { maximumFractionDigits: 0 })}
                    </span>
                    <span className="text-[10px] text-text-muted font-bold">{profile.baseCurrency}</span>
                  </div>
                  {trip.duration && (
                    <p className="text-[9px] text-text-muted mt-1 uppercase tracking-wider font-bold">
                      Průměr: {(user.value / trip.duration).toFixed(0)} {profile.baseCurrency} / den
                    </p>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-4 pt-4 border-t border-bg-soft">
              <p className="text-[10px] text-text-muted italic">
                * Zobrazuje se podle toho, kdo daný výdaj do aplikace zapsal.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Categories Chart */}
      <div className="bg-white p-6 rounded-[32px] shadow-sm">
        <div className="flex items-center gap-3 mb-6">
          <PieChart className="text-primary" />
          <h3 className="font-bold text-primary">
            {viewType === 'current' ? 'Rozdělení útrat' : 'Rozdělení útrat (všechny výlety)'}
          </h3>
        </div>
        
        <div className="flex flex-col gap-6 w-full">
          <div className="h-72 w-full">
            {isLoadingAll ? (
              <div className="w-full h-full flex items-center justify-center text-text-muted">Načítám data...</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart 
                  data={pieData} 
                  layout="vertical" 
                  margin={{ left: 30, right: 30, top: 10, bottom: 10 }}
                >
                  <XAxis type="number" hide />
                  <YAxis 
                    dataKey="name" 
                    type="category" 
                    width={80} 
                    tick={{ fontSize: 10, fontWeight: 'bold', fill: 'var(--primary)' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip 
                    cursor={{ fill: 'transparent' }}
                    contentStyle={{ 
                      borderRadius: '16px', 
                      border: 'none', 
                      boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                      backgroundColor: 'var(--bg-soft)',
                      color: 'var(--primary)'
                    }}
                    itemStyle={{ color: 'var(--primary)', fontWeight: 'bold' }}
                    formatter={(value: number) => [`${value.toFixed(0)} ${profile.baseCurrency}`, '']}
                  />
                  <Bar 
                    dataKey="value" 
                    radius={[0, 10, 10, 0]} 
                    barSize={24}
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-3">
            {isLoadingAll ? (
              <div className="col-span-full space-y-4">
                {[1,2,3].map(i => <div key={i} className="h-4 bg-gray-100 rounded-full animate-pulse" />)}
              </div>
            ) : sortedCategories.map((cat, index) => (
              <div key={cat.name} className="bg-bg-soft/50 p-3 rounded-2xl border border-transparent hover:border-primary/10 transition-colors">
                <div className="flex justify-between items-center text-xs mb-1">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cat.fill }} />
                    <span className="font-bold text-primary truncate max-w-[100px]">{cat.name}</span>
                  </div>
                  <span className="text-primary font-bold">{cat.value.toFixed(0)} {profile.baseCurrency}</span>
                </div>
                <div className="w-full bg-bg-soft h-1.5 rounded-full overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    whileInView={{ width: `${(cat.value / (totalInBase || 1)) * 100}%` }}
                    viewport={{ once: true }}
                    className="h-full rounded-full" 
                    style={{ backgroundColor: cat.fill }}
                  />
                </div>
              </div>
            ))}
            {!isLoadingAll && sortedCategories.length === 0 && (
              <p className="col-span-full text-center text-text-muted py-4">Žádná data k zobrazení.</p>
            )}
          </div>
        </div>
      </div>

      {/* Enhanced Comparison Section (Bottom) */}
      {viewType === 'current' && (
        <div className="bg-white p-8 rounded-[40px] shadow-sm border border-bg-soft space-y-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ArrowRightLeft className="text-primary" size={24} />
              <h3 className="text-xl font-serif text-primary">Detailní porovnání výletů</h3>
            </div>
            <select 
              value={compareTripId}
              onChange={(e) => handleCompare(e.target.value)}
              className="bg-bg-soft rounded-xl p-3 text-sm focus:ring-2 focus:ring-primary border-none"
            >
              <option value="">Vyber výlet pro porovnání</option>
              {allTrips.filter(t => t.id !== trip.id).map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          {!compareTripId ? (
            <div className="text-center py-12 bg-bg-soft/30 rounded-[32px] border-2 border-dashed border-bg-soft">
              <BarChart3 className="mx-auto text-text-muted mb-4 opacity-20" size={48} />
              <p className="text-sm text-text-muted">Vyberte jiný výlet pro zobrazení detailního porovnání nákladů, denních průměrů a kategorií.</p>
            </div>
          ) : compareData.length < 2 ? (
            <div className="text-center py-12 bg-bg-soft/30 rounded-[32px] border-2 border-dashed border-bg-soft">
              <Loader2 className="mx-auto text-primary mb-4 animate-spin" size={32} />
              <p className="text-sm text-text-muted">Načítám data pro porovnání...</p>
            </div>
          ) : (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-10"
            >
              {/* Total & Daily Comparison */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted">Celková útrata</p>
                  <div className="h-48 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={compareData}>
                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 'bold' }} />
                        <Tooltip 
                          contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                          formatter={(value: number) => [`${value.toFixed(0)} ${profile.baseCurrency}`, 'Celkem']}
                        />
                        <Bar dataKey="total" fill="var(--primary)" radius={[10, 10, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="space-y-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted">Denní průměr</p>
                  <div className="h-48 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={compareData}>
                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 'bold' }} />
                        <Tooltip 
                          contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                          formatter={(value: number) => [`${value.toFixed(0)} ${profile.baseCurrency}`, 'Průměr/den']}
                        />
                        <Bar dataKey="daily" fill="#F27D26" radius={[10, 10, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* Category Comparison Table */}
              <div className="space-y-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-text-muted">Porovnání kategorií</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[10px] font-bold uppercase tracking-widest text-text-muted border-b border-bg-soft">
                        <th className="text-left py-3 px-2">Kategorie</th>
                        <th className="text-right py-3 px-2">{compareData[0].name}</th>
                        <th className="text-right py-3 px-2">{compareData[1].name}</th>
                        <th className="text-right py-3 px-2">Rozdíl</th>
                      </tr>
                    </thead>
                    <tbody>
                      {profile.categories.map(cat => {
                        const val1 = compareData[0].categories[cat] || 0;
                        const val2 = compareData[1].categories[cat] || 0;
                        const diff = val1 - val2;
                        if (val1 === 0 && val2 === 0) return null;
                        return (
                          <tr key={cat} className="border-b border-bg-soft/50 last:border-none">
                            <td className="py-3 px-2 font-medium text-primary">{cat}</td>
                            <td className="text-right py-3 px-2">{val1.toFixed(0)}</td>
                            <td className="text-right py-3 px-2">{val2.toFixed(0)}</td>
                            <td className={`text-right py-3 px-2 font-bold ${diff > 0 ? 'text-red-500' : 'text-green-500'}`}>
                              {diff > 0 ? '+' : ''}{diff.toFixed(0)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Summary Conclusion */}
              <div className="p-6 bg-bg-soft rounded-[32px] border border-primary/5">
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles className="text-primary" size={18} />
                  <p className="text-xs font-bold uppercase tracking-widest text-primary">Rychlý závěr</p>
                </div>
                <p className="text-sm text-primary leading-relaxed">
                  Výlet <strong>{compareData[0].name}</strong> vás v průměru stojí o <strong>{Math.abs(compareData[0].daily - compareData[1].daily).toFixed(0)} {profile.baseCurrency}</strong> {compareData[0].daily > compareData[1].daily ? 'více' : 'méně'} na den než <strong>{compareData[1].name}</strong>. 
                  {compareData[0].total > compareData[1].total 
                    ? ` Celkově jste zatím utratili o ${ (compareData[0].total - compareData[1].total).toFixed(0) } ${profile.baseCurrency} více.`
                    : ` Celkově jste zatím utratili o ${ (compareData[1].total - compareData[0].total).toFixed(0) } ${profile.baseCurrency} méně.`
                  }
                </p>
              </div>
            </motion.div>
          )}
        </div>
      )}
    </div>
  );
}
