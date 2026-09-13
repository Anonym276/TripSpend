import { useState, useRef, useEffect, useMemo } from 'react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { doc, deleteDoc, updateDoc, collection, writeBatch, addDoc } from 'firebase/firestore';
import { Expense, Trip, UserProfile, Person } from '../types';
import { 
  Trash2, Edit2, CreditCard, Banknote, X, Save, Download, Cloud, Calendar, 
  Minus, Plus, Upload, FileText, Loader2, Filter, Search, Coins, Users, Check,
  Copy, ArrowUpDown, ArrowUp, ArrowDown, CheckCircle2
} from 'lucide-react';
import { format, addDays, subDays, isWithinInterval, startOfDay, endOfDay } from 'date-fns';
import * as XLSX from 'xlsx';
import { motion, AnimatePresence } from 'motion/react';
import { getDisplayPaidByName } from '../services/dateUtils';

// Add custom cn utility just in case
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface ExpenseListProps {
  expenses: Expense[];
  trip: Trip;
  profile: UserProfile;
  withdrawals: any[];
  exchangeRates: Record<string, number> | null;
  people: Person[];
}

export default function ExpenseList({ expenses, trip, profile, withdrawals, exchangeRates, people }: ExpenseListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Expense>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ success: number; total: number; error?: string } | null>(null);

  // Filtering states
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [filterCategory, setFilterCategory] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterMinAmount, setFilterMinAmount] = useState<string>('');
  const [filterMaxAmount, setFilterMaxAmount] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');

  // Sorting states
  type SortField = 'date' | 'category' | 'amount' | 'paymentMethod';
  type SortOrder = 'asc' | 'desc';
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  // Duplicating state & Feedback Toast
  const [isDuplicatingId, setIsDuplicatingId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const getCategoryStyles = (cat: string) => {
    const normalized = (cat || '').toLowerCase().trim();
    if (normalized.includes('jídlo') || normalized.includes('restaurace') || normalized.includes('snídaně') || normalized.includes('food') || normalized.includes('oběd') || normalized.includes('večeře')) {
      return { badgeBg: 'bg-amber-100/80 text-amber-900 border-amber-200' };
    }
    if (normalized.includes('ubytov') || normalized.includes('hotel') || normalized.includes('camp') || normalized.includes('stay') || normalized.includes('apartmán')) {
      return { badgeBg: 'bg-purple-100/80 text-purple-900 border-purple-200' };
    }
    if (normalized.includes('doprav') || normalized.includes('taxi') || normalized.includes('jízden') || normalized.includes('auto') || normalized.includes('benz') || normalized.includes('phm') || normalized.includes('transport') || normalized.includes('mýto')) {
      return { badgeBg: 'bg-sky-100/80 text-sky-900 border-sky-200' };
    }
    if (normalized.includes('zábav') || normalized.includes('vstup') || normalized.includes('kino') || normalized.includes('bar') || normalized.includes('pivo') || normalized.includes('entertainment') || normalized.includes('sport')) {
      return { badgeBg: 'bg-emerald-100/80 text-emerald-900 border-emerald-200' };
    }
    if (normalized.includes('nákup') || normalized.includes('supermarket') || normalized.includes('potraviny') || normalized.includes('obchod')) {
      return { badgeBg: 'bg-teal-100/80 text-teal-900 border-teal-200' };
    }
    return { badgeBg: 'bg-slate-100 text-slate-800 border-slate-200' };
  };

  const activeFilterCount = useMemo(() => {
    return [
      Boolean(filterCategory),
      Boolean(filterDateFrom),
      Boolean(filterDateTo),
      Boolean(filterMinAmount),
      Boolean(filterMaxAmount),
      Boolean(searchQuery)
    ].filter(Boolean).length;
  }, [filterCategory, filterDateFrom, filterDateTo, filterMinAmount, filterMaxAmount, searchQuery]);

  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => {
        setToastMessage(null);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder(field === 'category' ? 'asc' : 'desc');
    }
  };

  const filteredExpenses = useMemo(() => {
    return expenses.filter(e => {
      // Search query (description, category, recipient, paymentMethod)
      if (searchQuery) {
        const q = searchQuery.toLowerCase().trim();
        const matchesDesc = e.description?.toLowerCase().includes(q);
        const matchesCat = e.category?.toLowerCase().includes(q);
        const matchesRecipient = e.recipient?.toLowerCase().includes(q);
        const matchesMethod = e.paymentMethod?.toLowerCase().includes(q);
        if (!matchesDesc && !matchesCat && !matchesRecipient && !matchesMethod) {
          return false;
        }
      }

      // Category
      if (filterCategory && e.category !== filterCategory) {
        return false;
      }

      // Date range
      const expenseDate = new Date(e.date);
      if (filterDateFrom && expenseDate < startOfDay(new Date(filterDateFrom))) {
        return false;
      }
      if (filterDateTo && expenseDate > endOfDay(new Date(filterDateTo))) {
        return false;
      }

      // Amount range
      if (filterMinAmount && e.amountInBase < parseFloat(filterMinAmount)) {
        return false;
      }
      if (filterMaxAmount && e.amountInBase > parseFloat(filterMaxAmount)) {
        return false;
      }

      return true;
    });
  }, [expenses, searchQuery, filterCategory, filterDateFrom, filterDateTo, filterMinAmount, filterMaxAmount]);

  const sortedExpenses = useMemo(() => {
    return [...filteredExpenses].sort((a, b) => {
      let comparison = 0;
      if (sortField === 'date') {
        comparison = new Date(a.date).getTime() - new Date(b.date).getTime();
      } else if (sortField === 'category') {
        comparison = (a.category || '').localeCompare(b.category || '', 'cs');
        if (comparison === 0) {
          comparison = (a.description || '').localeCompare(b.description || '', 'cs');
        }
      } else if (sortField === 'amount') {
        comparison = (a.amountInBase || a.amount || 0) - (b.amountInBase || b.amount || 0);
      } else if (sortField === 'paymentMethod') {
        comparison = (a.paymentMethod || '').localeCompare(b.paymentMethod || '', 'cs');
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });
  }, [filteredExpenses, sortField, sortOrder]);

  // Auto-dismiss import result if successful
  useEffect(() => {
    if (importResult && !importResult.error) {
      const timer = setTimeout(() => {
        setImportResult(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [importResult]);

  const toggleSelectAll = () => {
    if (selectedIds.size === expenses.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(expenses.map(e => e.id)));
    }
  };

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Don't trigger edit modal
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    try {
      const batch = writeBatch(db);
      selectedIds.forEach(id => {
        batch.delete(doc(db, 'expenses', id));
      });
      await batch.commit();
      setSelectedIds(new Set());
      setShowBulkDeleteConfirm(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `expenses (bulk: ${selectedIds.size})`);
    }
  };

  const downloadExample = () => {
    const exampleData = [
      {
        'Datum': format(new Date(), 'yyyy-MM-dd'),
        'Příjemce': 'Restaurace U Lva',
        'Popis': 'Večeře v restauraci',
        'Částka': 150,
        'Měna': trip.currency,
        'Metoda': 'KARTA',
        [`Kurz na ${profile.baseCurrency}`]: trip.lastRate || 1,
        [`Castka ${profile.baseCurrency}`]: 150 * (trip.lastRate || 1),
        'Kategorie': profile.categories[0] || 'Jídlo',
      },
      {
        'Datum': format(new Date(), 'yyyy-MM-dd'),
        'Příjemce': 'DPP',
        'Popis': 'Lístek na metro',
        'Částka': 2.5,
        'Měna': 'EUR',
        'Metoda': 'CASH',
        [`Kurz na ${profile.baseCurrency}`]: 25,
        [`Castka ${profile.baseCurrency}`]: 62.5,
        'Kategorie': profile.categories[1] || 'Doprava',
      }
    ];

    const ws = XLSX.utils.json_to_sheet(exampleData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Vzor_importu");
    XLSX.writeFile(wb, "Vzor_importu_vydaju.xlsx");
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary', cellDates: true });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws) as any[];

        const batch = writeBatch(db);
        let count = 0;
        const newCategories = new Set<string>();
        let lastDate: Date | null = null;

        // Helper to parse numbers robustly
        const parseNum = (val: any): number => {
          if (val === null || val === undefined || val === '') return 0;
          if (typeof val === 'number') return val;
          const str = String(val).replace(/\s/g, '').replace(',', '.');
          const num = parseFloat(str);
          return isNaN(num) ? 0 : num;
        };

        // Helper to parse dates robustly (handles DD.MM.YYYY and Excel numbers)
        const parseDate = (val: any): Date | null => {
          if (!val) return null;
          if (val instanceof Date) return val;
          
          if (typeof val === 'number') {
            // Excel serial date to JS Date
            return new Date(Math.round((val - 25569) * 86400 * 1000));
          }

          const str = String(val).trim();
          if (!str) return null;
          
          // Try standard parsing
          const d = new Date(str);
          if (!isNaN(d.getTime())) return d;

          // Try DD.MM.YYYY
          const match = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
          if (match) {
            const day = parseInt(match[1]);
            const month = parseInt(match[2]) - 1;
            const year = parseInt(match[3]);
            const d2 = new Date(year, month, day);
            if (!isNaN(d2.getTime())) return d2;
          }

          return null;
        };

        // Filter valid-looking rows to get a better total count
        const validRows = data.filter(row => !Object.values(row).every(v => v === null || v === undefined || v === ''));

        for (const row of validRows) {
          // Date parsing with carry-over for repeated dates
          const rowDateRaw = row['Datum'] || row['datum'] || row['Date'] || row['date'];
          let date = parseDate(rowDateRaw);
          
          if (!date || isNaN(date.getTime())) {
            if (lastDate) {
              date = lastDate;
            } else {
              continue;
            }
          } else {
            lastDate = date;
          }

          const amount = parseNum(row['Částka'] || row['Castka'] || row['Amount'] || row['amount'] || row['Cena'] || row['castka']);
          if (amount <= 0) continue;

          const currency = (row['Měna'] || row['Mena'] || row['Currency'] || row['currency'] || trip.currency).toString().toUpperCase();
          const description = row['Popis'] || row['popis'] || row['Description'] || row['description'] || row['Kategorie'] || row['Category'] || 'Importovaný výdaj';
          const rawCategory = (row['Kategorie'] || row['Category'] || row['category'] || 'Ostatní').toString().trim();
          const category = rawCategory || 'Ostatní';

          if (category && !profile.categories.includes(category)) {
            newCategories.add(category);
          }

          const paymentMethod = (row['Metoda'] || row['Jak'] || row['Method'] || row['method'] || row['jak'] || 'KARTA').toString().toUpperCase();
          const recipient = row['Příjemce'] || row['Komu'] || row['Recipient'] || row['recipient'] || row['Prijemce'] || row['prijemce'] || row['komu'] || '';

          // Calculate exchange rate
          let rate = 1;
          const excelRate = parseNum(row[`Kurz na ${profile.baseCurrency}`] || row['Kurz'] || row['Rate'] || row['rate'] || row['kurz']);
          const excelAmountInBase = parseNum(
            row[`Castka ${profile.baseCurrency}`] || 
            row[`Částka v ${profile.baseCurrency}`] || 
            row['Castka CZK'] || 
            row['Částka v CZK'] ||
            row['Amount Base'] ||
            row['baseAmount'] ||
            row['Castka_CZK']
          );

          if (excelRate > 0) {
            rate = excelRate;
          } else if (excelAmountInBase > 0) {
            rate = excelAmountInBase / amount;
          } else {
            if (currency === profile.baseCurrency) {
              rate = 1;
            } else if (currency === trip.currency) {
              rate = trip.lastRate;
            } else if (exchangeRates && exchangeRates[currency]) {
              const baseRate = exchangeRates[profile.baseCurrency] || 1;
              const currencyRate = exchangeRates[currency];
              rate = baseRate / currencyRate;
            }
          }
          
          const amountInBase = excelAmountInBase > 0 ? excelAmountInBase : (amount * rate);

          const newExpenseRef = doc(collection(db, 'expenses'));
          batch.set(newExpenseRef, {
            tripId: trip.id,
            ownerId: profile.uid,
            date: date.toISOString(),
            amount,
            currency,
            description,
            category,
            paymentMethod,
            recipient,
            rate,
            amountInBase,
            createdAt: new Date().toISOString()
          });
          count++;
          
          if (count >= 500) break;
        }

        if (count > 0) {
          if (newCategories.size > 0) {
            const updatedCategories = [...profile.categories, ...Array.from(newCategories)];
            await updateDoc(doc(db, 'users', profile.uid), {
              categories: updatedCategories
            });
          }

          await batch.commit();
          setImportResult({ success: count, total: validRows.length });
        } else if (validRows.length === 0) {
          setImportResult({ success: 0, total: 0, error: 'Soubor neobsahuje žádná platná data k importu.' });
        } else {
          setImportResult({ success: 0, total: validRows.length, error: 'Nebyla nalezena žádná platná útrata.' });
        }
      } catch (error) {
        console.error("Import Error:", error);
        setImportResult({ success: 0, total: 0, error: 'Chyba při čtení nebo nahrávání souboru. Zkontrolujte formát.' });
      } finally {
        setIsImporting(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'expenses', id));
      setConfirmDeleteId(null);
      setEditingId(null);
      setToastMessage('Útrata byla smazána.');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `expenses/${id}`);
    }
  };

  const handleDeleteBulk = async () => {
    if (selectedIds.size === 0) return;
    try {
      const batch = writeBatch(db);
      selectedIds.forEach(id => {
        batch.delete(doc(db, 'expenses', id));
      });
      await batch.commit();
      setToastMessage(`Smazáno ${selectedIds.size} útrat.`);
      setSelectedIds(new Set());
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'expenses');
    }
  };

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

  const handleStartEdit = (expense: Expense) => {
    setEditingId(expense.id);
    setEditForm({
      ...expense,
      recipient: expense.recipient || '',
      splitBetween: expense.splitBetween || allParticipants.map(p => p.id)
    });
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editForm.amount) return;
    try {
      const { id, _hasPendingWrites, ...data } = editForm as Expense;
      
      // Recalculate rate if amountInBase was updated, or vice versa
      // For simplicity, we trust the fields as they are in the form
      // but if it's a card payment and user provided amountInBase, we ensure rate is correct
      let finalRate = data.rate;
      if (data.paymentMethod !== 'CASH' && data.amountInBase > 0) {
        finalRate = data.amountInBase / data.amount;
      } else if (data.paymentMethod === 'CASH') {
        data.amountInBase = data.amount * data.rate;
      }

      // Recalculate paidByName
      let finalPaidByName = data.paidByName || '';
      if (data.paidBy === 'me') {
        finalPaidByName = 'Já';
      } else if (data.paidBy) {
        const matched = people.find(p => p.id === data.paidBy);
        finalPaidByName = matched ? matched.name : 'Neznámý';
      }

      await updateDoc(doc(db, 'expenses', editingId), {
        ...data,
        recipient: data.recipient !== undefined ? data.recipient.trim() : '',
        rate: finalRate,
        paidByName: finalPaidByName
      });
      setEditingId(null);
      setToastMessage('Útrata byla úspěšně upravena.');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `expenses/${editingId}`);
    }
  };

  const handleDuplicateExpense = async (expense: Expense, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      setIsDuplicatingId(expense.id);
      const { id, _hasPendingWrites, ...expenseData } = expense;
      const duplicatedExpense = {
        ...expenseData,
        recipient: expenseData.recipient || '',
        tripId: trip.id,
        ownerId: trip.ownerId,
        createdBy: profile.uid,
        createdByName: profile.displayName || 'Uživatel',
        createdAt: new Date().toISOString(),
      };
      await addDoc(collection(db, 'expenses'), duplicatedExpense);
      setToastMessage(`Záznam "${expense.description || expense.category}" byl zkopírován.`);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'expenses');
    } finally {
      setIsDuplicatingId(null);
    }
  };

  const handleDuplicateFromModal = async () => {
    if (!editForm.amount) return;
    try {
      setIsDuplicatingId('modal');
      const { id, _hasPendingWrites, ...data } = editForm as Expense;
      
      let finalRate = data.rate || 1;
      if (data.paymentMethod !== 'CASH' && (data.amountInBase || 0) > 0 && data.amount > 0) {
        finalRate = data.amountInBase / data.amount;
      } else if (data.paymentMethod === 'CASH') {
        data.amountInBase = data.amount * finalRate;
      }

      let finalPaidByName = data.paidByName || '';
      if (data.paidBy === 'me') {
        finalPaidByName = 'Já';
      } else if (data.paidBy) {
        const matched = people.find(p => p.id === data.paidBy);
        finalPaidByName = matched ? matched.name : 'Neznámý';
      }

      const duplicatedData = {
        ...data,
        recipient: data.recipient !== undefined ? data.recipient.trim() : '',
        rate: finalRate,
        paidByName: finalPaidByName,
        tripId: trip.id,
        ownerId: trip.ownerId,
        createdBy: profile.uid,
        createdByName: profile.displayName || 'Uživatel',
        createdAt: new Date().toISOString(),
      };

      await addDoc(collection(db, 'expenses'), duplicatedData);
      setEditingId(null);
      setToastMessage(`Kopie útraty "${duplicatedData.description || duplicatedData.category}" byla vytvořena.`);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'expenses');
    } finally {
      setIsDuplicatingId(null);
    }
  };

  const handleExport = () => {
    const dataToExport = expenses.map(e => ({
      'Datum': format(new Date(e.date), 'yyyy-MM-dd'),
      'Příjemce': e.recipient || '-',
      'Popis': e.description,
      'Částka': e.amount,
      'Měna': e.currency,
      'Metoda': e.paymentMethod,
      [`Kurz na ${profile.baseCurrency}`]: e.rate,
      [`Castka ${profile.baseCurrency}`]: e.amountInBase,
      'Kategorie': e.category,
    }));

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Výdaje");
    XLSX.writeFile(wb, `Vydaje_${trip.name.replace(/\s+/g, '_')}.xlsx`);
  };

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-16">
      {/* Header Title & Actions */}
      <div className="flex flex-col gap-3 px-2 sm:px-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-bold text-lg sm:text-xl text-primary truncate">
            {trip.name} <span className="text-text-muted font-normal text-sm sm:text-base">- Seznam útrat</span>
          </h2>
          <button 
            onClick={() => setIsFilterOpen(!isFilterOpen)}
            className={`flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider px-3 py-2 rounded-xl shadow-xs transition-all shrink-0 cursor-pointer ${
              isFilterOpen || activeFilterCount > 0 
                ? 'bg-primary text-white' 
                : 'bg-white text-primary hover:bg-bg-soft border border-border-subtle/70'
            }`}
          >
            <Filter size={14} />
            <span>Filtry</span>
            {activeFilterCount > 0 && (
              <span className="w-4 h-4 rounded-full bg-amber-400 text-slate-900 text-[10px] flex items-center justify-center font-black">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {/* Search & Actions Row */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input 
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Hledat..."
              className="w-full pl-9 pr-8 py-2 text-xs bg-white border border-border-subtle/80 rounded-xl shadow-xs focus:ring-2 focus:ring-primary outline-none"
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-primary p-0.5 cursor-pointer"
              >
                <X size={13} />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleImport} 
              accept=".xlsx,.xls,.csv" 
              className="hidden" 
            />
            <button 
              onClick={downloadExample}
              className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-text-muted bg-white border border-border-subtle/70 px-2.5 py-2 rounded-xl shadow-xs hover:bg-bg-soft transition-colors cursor-pointer"
              title="Stáhnout vzor pro import"
            >
              <FileText size={13} />
              <span className="hidden sm:inline">Vzor</span>
            </button>
            <button 
              onClick={() => fileInputRef.current?.click()}
              disabled={isImporting}
              className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-primary bg-white border border-border-subtle/70 px-2.5 py-2 rounded-xl shadow-xs hover:bg-bg-soft transition-colors disabled:opacity-50 cursor-pointer"
              title="Importovat z Excelu"
            >
              {isImporting ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
              <span className="hidden sm:inline">Import</span>
            </button>
            <button 
              onClick={handleExport}
              className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-primary bg-white border border-border-subtle/70 px-2.5 py-2 rounded-xl shadow-xs hover:bg-bg-soft transition-colors cursor-pointer"
              title="Exportovat do Excelu"
            >
              <Download size={13} />
              <span className="hidden sm:inline">Export</span>
            </button>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {isFilterOpen && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden px-2 sm:px-4"
          >
            <div className="bg-white p-5 sm:p-6 rounded-[28px] sm:rounded-[32px] shadow-sm border border-bg-soft grid grid-cols-2 md:grid-cols-5 gap-3 sm:gap-4">
              <div className="space-y-1 col-span-2 sm:col-span-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted px-2">Kategorie</label>
                <select 
                  value={filterCategory}
                  onChange={(e) => setFilterCategory(e.target.value)}
                  className="w-full p-2.5 bg-bg-soft border-none rounded-xl text-xs focus:ring-1 focus:ring-primary"
                >
                  <option value="">Všechny kategorie</option>
                  {profile.categories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted px-2">Od data</label>
                <input 
                  type="date"
                  value={filterDateFrom}
                  onChange={(e) => setFilterDateFrom(e.target.value)}
                  className="w-full p-2.5 bg-bg-soft border-none rounded-xl text-xs focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted px-2">Do data</label>
                <input 
                  type="date"
                  value={filterDateTo}
                  onChange={(e) => setFilterDateTo(e.target.value)}
                  className="w-full p-2.5 bg-bg-soft border-none rounded-xl text-xs focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted px-2">Min. ({profile.baseCurrency})</label>
                <input 
                  type="number"
                  value={filterMinAmount}
                  onChange={(e) => setFilterMinAmount(e.target.value)}
                  placeholder="Min"
                  className="w-full p-2.5 bg-bg-soft border-none rounded-xl text-xs focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-text-muted px-2">Max. ({profile.baseCurrency})</label>
                <input 
                  type="number"
                  value={filterMaxAmount}
                  onChange={(e) => setFilterMaxAmount(e.target.value)}
                  placeholder="Max"
                  className="w-full p-2.5 bg-bg-soft border-none rounded-xl text-xs focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="col-span-full flex justify-end gap-2 pt-2 border-t border-bg-soft">
                <button 
                  onClick={() => {
                    setFilterCategory('');
                    setFilterDateFrom('');
                    setFilterDateTo('');
                    setFilterMinAmount('');
                    setFilterMaxAmount('');
                    setSearchQuery('');
                  }}
                  className="text-[10px] font-bold uppercase tracking-widest text-red-500 hover:underline cursor-pointer"
                >
                  Resetovat filtry
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {expenses.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-[28px] sm:rounded-[32px] shadow-sm p-6">
          <p className="text-text-muted">Zatím žádné útraty. Můžete je přidat ručně nebo importovat.</p>
        </div>
      ) : (
        <>
          {/* ============================================================ */}
          {/* MOBILE VIEW (< md): Card list with quick sort bar */}
          {/* ============================================================ */}
          <div className="block md:hidden space-y-3">
            {/* Mobile Toolbar: Select All + Bulk Actions + Quick Sort */}
            <div className="bg-white rounded-2xl p-3 shadow-xs border border-border-subtle/60 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <input 
                    type="checkbox" 
                    id="select-all-mobile"
                    checked={sortedExpenses.length > 0 && selectedIds.size === sortedExpenses.length}
                    onChange={() => {
                      if (selectedIds.size === sortedExpenses.length) {
                        setSelectedIds(new Set());
                      } else {
                        setSelectedIds(new Set(sortedExpenses.map(e => e.id)));
                      }
                    }}
                    className="w-4 h-4 rounded border-border-subtle text-primary focus:ring-primary cursor-pointer"
                  />
                  <label htmlFor="select-all-mobile" className="text-[11px] font-bold text-text-muted uppercase tracking-wider cursor-pointer">
                    {selectedIds.size > 0 ? `Vybráno ${selectedIds.size} z ${sortedExpenses.length}` : `Vybrat vše (${sortedExpenses.length})`}
                  </label>
                </div>

                {selectedIds.size > 0 && (
                  <button
                    onClick={handleDeleteBulk}
                    className="text-[11px] font-bold text-red-500 hover:text-red-600 flex items-center gap-1 cursor-pointer bg-red-50 px-2.5 py-1 rounded-lg"
                  >
                    <Trash2 size={12} /> Smazat ({selectedIds.size})
                  </button>
                )}
              </div>

              {/* Quick Sort Bar */}
              <div className="pt-2 border-t border-border-subtle/50 flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
                <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted shrink-0 mr-0.5">Řadit:</span>
                
                <button
                  type="button"
                  onClick={() => handleSort('date')}
                  className={`text-[11px] font-bold px-2.5 py-1 rounded-xl flex items-center gap-1 shrink-0 transition-colors cursor-pointer ${
                    sortField === 'date' ? 'bg-primary text-white shadow-xs' : 'bg-bg-soft text-text-muted hover:text-primary'
                  }`}
                >
                  <span>Datum</span>
                  {sortField === 'date' ? (
                    sortOrder === 'asc' ? <ArrowUp size={11} className="stroke-[2.5]" /> : <ArrowDown size={11} className="stroke-[2.5]" />
                  ) : (
                    <ArrowUpDown size={11} className="opacity-40" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => handleSort('category')}
                  className={`text-[11px] font-bold px-2.5 py-1 rounded-xl flex items-center gap-1 shrink-0 transition-colors cursor-pointer ${
                    sortField === 'category' ? 'bg-primary text-white shadow-xs' : 'bg-bg-soft text-text-muted hover:text-primary'
                  }`}
                >
                  <span>Kategorie</span>
                  {sortField === 'category' ? (
                    sortOrder === 'asc' ? <ArrowUp size={11} className="stroke-[2.5]" /> : <ArrowDown size={11} className="stroke-[2.5]" />
                  ) : (
                    <ArrowUpDown size={11} className="opacity-40" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => handleSort('amount')}
                  className={`text-[11px] font-bold px-2.5 py-1 rounded-xl flex items-center gap-1 shrink-0 transition-colors cursor-pointer ${
                    sortField === 'amount' ? 'bg-primary text-white shadow-xs' : 'bg-bg-soft text-text-muted hover:text-primary'
                  }`}
                >
                  <span>Částka</span>
                  {sortField === 'amount' ? (
                    sortOrder === 'asc' ? <ArrowUp size={11} className="stroke-[2.5]" /> : <ArrowDown size={11} className="stroke-[2.5]" />
                  ) : (
                    <ArrowUpDown size={11} className="opacity-40" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => handleSort('paymentMethod')}
                  className={`text-[11px] font-bold px-2.5 py-1 rounded-xl flex items-center gap-1 shrink-0 transition-colors cursor-pointer ${
                    sortField === 'paymentMethod' ? 'bg-primary text-white shadow-xs' : 'bg-bg-soft text-text-muted hover:text-primary'
                  }`}
                >
                  <span>Metoda</span>
                  {sortField === 'paymentMethod' ? (
                    sortOrder === 'asc' ? <ArrowUp size={11} className="stroke-[2.5]" /> : <ArrowDown size={11} className="stroke-[2.5]" />
                  ) : (
                    <ArrowUpDown size={11} className="opacity-40" />
                  )}
                </button>
              </div>
            </div>

            {/* Mobile Cards */}
            <div className="space-y-2.5">
              <AnimatePresence initial={false}>
                {sortedExpenses.map((expense) => {
                  const displayPayerName = getDisplayPaidByName(expense, profile.uid, people);
                  const isSelected = selectedIds.has(expense.id);
                  const categoryStyle = getCategoryStyles(expense.category);

                  return (
                    <motion.div
                      key={expense.id}
                      layout
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ duration: 0.18 }}
                      onClick={() => handleStartEdit(expense)}
                      className={`p-3.5 rounded-2xl border transition-all cursor-pointer relative ${
                        isSelected 
                          ? 'bg-primary/5 border-primary/40 shadow-xs' 
                          : 'bg-white border-border-subtle/70 active:bg-bg-soft/70 shadow-xs'
                      }`}
                    >
                      {/* Top row: Checkbox, Date, Category Badge & Amount */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div onClick={(e) => e.stopPropagation()} className="shrink-0 flex items-center">
                            <input 
                              type="checkbox" 
                              checked={isSelected}
                              onChange={(e) => toggleSelect(expense.id, e as any)}
                              className="w-4 h-4 rounded border-border-subtle text-primary focus:ring-primary cursor-pointer"
                            />
                          </div>
                          <div className="flex items-center gap-1 font-bold text-xs text-primary shrink-0">
                            {expense._hasPendingWrites && <Cloud size={10} className="text-amber-500 animate-pulse" />}
                            {format(new Date(expense.date), 'd. M.')}
                          </div>
                          <span className={`text-[10px] px-2 py-0.5 rounded-md font-bold uppercase tracking-wider truncate max-w-[110px] border ${categoryStyle.badgeBg}`}>
                            {expense.category}
                          </span>
                        </div>

                        {/* Amount */}
                        <div className="text-right shrink-0">
                          <span className="font-serif font-bold text-base text-primary whitespace-nowrap">
                            {expense.amount.toLocaleString('cs-CZ')} {expense.currency || trip.currency}
                          </span>
                        </div>
                      </div>

                      {/* Middle row: Description & Recipient */}
                      <div className="pl-6 pt-1">
                        <div className="flex items-baseline gap-1.5 flex-wrap">
                          <span className="font-bold text-sm text-primary leading-snug">
                            {expense.description || expense.category}
                          </span>
                          {expense.recipient && (
                            <span className="text-xs text-text-muted font-medium">
                              • {expense.recipient}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Bottom row: Payment Method, Payer, Converted Amount, and Copy Button */}
                      <div className="pl-6 pt-2 flex items-center justify-between gap-2 border-t border-border-subtle/40 mt-1.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {/* Payment method */}
                          <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-bg-soft text-text-muted font-semibold flex items-center gap-1 border border-border-subtle/50">
                            {expense.paymentMethod === 'CASH' ? <Banknote size={11} className="text-amber-600" /> : <CreditCard size={11} className="text-blue-600" />}
                            {expense.paymentMethod === 'CASH' ? 'Hotovost' : 'Karta'}
                          </span>

                          {/* Payer */}
                          {displayPayerName && (
                            <span className="text-[9px] px-1.5 py-0.5 bg-emerald-50 text-emerald-800 rounded border border-emerald-500/20 font-semibold flex items-center gap-1" title={`Platil: ${displayPayerName}`}>
                              <Coins size={10} className="shrink-0 text-emerald-600" /> Platil: {displayPayerName}
                            </span>
                          )}

                          {/* Converted amount if currency differs */}
                          {(expense.currency && expense.currency !== profile.baseCurrency) && (
                            <span className={`text-[10px] ${expense.amountInBase === 0 ? 'text-amber-500 italic font-medium' : 'text-text-muted font-medium'}`}>
                              ≈ {expense.amountInBase.toLocaleString('cs-CZ')} {profile.baseCurrency}
                            </span>
                          )}
                        </div>

                        {/* Duplicate Button */}
                        <div onClick={(e) => e.stopPropagation()} className="shrink-0">
                          <button
                            type="button"
                            onClick={(e) => handleDuplicateExpense(expense, e)}
                            disabled={isDuplicatingId === expense.id}
                            title="Kopírovat útratu"
                            className="p-1 px-2 rounded-xl text-text-muted hover:text-primary hover:bg-primary/10 transition-all active:scale-95 disabled:opacity-50 inline-flex items-center gap-1 text-[11px] font-bold cursor-pointer border border-border-subtle/60 bg-white"
                          >
                            {isDuplicatingId === expense.id ? (
                              <Loader2 size={12} className="animate-spin text-primary" />
                            ) : (
                              <Copy size={12} />
                            )}
                            <span className="text-[10px]">Kopie</span>
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </div>

          {/* ============================================================ */}
          {/* DESKTOP VIEW (>= md): Full Responsive Table */}
          {/* ============================================================ */}
          <div className="hidden md:block bg-white rounded-[32px] shadow-sm overflow-hidden border border-border-subtle/40">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-bg-soft border-b border-border-subtle select-none">
                    <th className="pl-4 pr-2 py-3 w-10">
                      <input 
                        type="checkbox" 
                        checked={sortedExpenses.length > 0 && selectedIds.size === sortedExpenses.length}
                        onChange={() => {
                          if (selectedIds.size === sortedExpenses.length) {
                            setSelectedIds(new Set());
                          } else {
                            setSelectedIds(new Set(sortedExpenses.map(e => e.id)));
                          }
                        }}
                        className="w-4 h-4 rounded border-border-subtle text-primary focus:ring-primary cursor-pointer"
                      />
                    </th>
                    <th 
                      onClick={() => handleSort('date')}
                      className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-text-muted hover:text-primary cursor-pointer transition-colors group"
                    >
                      <div className="flex items-center gap-1.5">
                        <span>Datum</span>
                        <span className={cn("transition-colors", sortField === 'date' ? "text-primary" : "text-text-muted/40 group-hover:text-text-muted")}>
                          {sortField === 'date' ? (
                            sortOrder === 'asc' ? <ArrowUp size={12} className="stroke-[2.5]" /> : <ArrowDown size={12} className="stroke-[2.5]" />
                          ) : (
                            <ArrowUpDown size={12} />
                          )}
                        </span>
                      </div>
                    </th>
                    <th 
                      onClick={() => handleSort('category')}
                      className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-text-muted hover:text-primary cursor-pointer transition-colors group"
                    >
                      <div className="flex items-center gap-1.5">
                        <span>Popis / Kat.</span>
                        <span className={cn("transition-colors", sortField === 'category' ? "text-primary" : "text-text-muted/40 group-hover:text-text-muted")}>
                          {sortField === 'category' ? (
                            sortOrder === 'asc' ? <ArrowUp size={12} className="stroke-[2.5]" /> : <ArrowDown size={12} className="stroke-[2.5]" />
                          ) : (
                            <ArrowUpDown size={12} />
                          )}
                        </span>
                      </div>
                    </th>
                    <th 
                      onClick={() => handleSort('amount')}
                      className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-text-muted hover:text-primary cursor-pointer transition-colors group text-right"
                    >
                      <div className="flex items-center justify-end gap-1.5">
                        <span>Částka</span>
                        <span className={cn("transition-colors", sortField === 'amount' ? "text-primary" : "text-text-muted/40 group-hover:text-text-muted")}>
                          {sortField === 'amount' ? (
                            sortOrder === 'asc' ? <ArrowUp size={12} className="stroke-[2.5]" /> : <ArrowDown size={12} className="stroke-[2.5]" />
                          ) : (
                            <ArrowUpDown size={12} />
                          )}
                        </span>
                      </div>
                    </th>
                    <th 
                      onClick={() => handleSort('paymentMethod')}
                      className="px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-text-muted hover:text-primary cursor-pointer transition-colors group text-center"
                    >
                      <div className="flex items-center justify-center gap-1.5">
                        <span>Metoda</span>
                        <span className={cn("transition-colors", sortField === 'paymentMethod' ? "text-primary" : "text-text-muted/40 group-hover:text-text-muted")}>
                          {sortField === 'paymentMethod' ? (
                            sortOrder === 'asc' ? <ArrowUp size={12} className="stroke-[2.5]" /> : <ArrowDown size={12} className="stroke-[2.5]" />
                          ) : (
                            <ArrowUpDown size={12} />
                          )}
                        </span>
                      </div>
                    </th>
                    <th className="pr-4 pl-2 py-3 text-[10px] font-bold uppercase tracking-widest text-text-muted text-right w-12">
                      <span className="sr-only">Kopírovat</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence initial={false}>
                    {sortedExpenses.map((expense) => {
                      const displayPayerName = getDisplayPaidByName(expense, profile.uid, people);
                      return (
                        <motion.tr 
                          key={expense.id} 
                          layout
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, x: -20 }}
                          transition={{ duration: 0.2 }}
                          onClick={() => handleStartEdit(expense)}
                          className={`border-b border-border-subtle hover:bg-bg-soft transition-colors cursor-pointer group/row ${selectedIds.has(expense.id) ? 'bg-primary/5' : ''}`}
                        >
                          <td className="pl-4 pr-2 py-4" onClick={(e) => e.stopPropagation()}>
                            <input 
                              type="checkbox" 
                              checked={selectedIds.has(expense.id)}
                              onChange={(e) => toggleSelect(expense.id, e as any)}
                              className="w-4 h-4 rounded border-border-subtle text-primary focus:ring-primary cursor-pointer"
                            />
                          </td>
                          <td className="px-4 py-4 text-sm text-primary">
                            <div className="flex items-center gap-1 font-medium">
                              {expense._hasPendingWrites && <Cloud size={10} className="text-amber-500 animate-pulse" />}
                              {format(new Date(expense.date), 'd. M.')}
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            <div className="flex flex-col">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-bold text-primary text-sm truncate max-w-[180px]">
                                  {expense.description || expense.category}
                                </span>
                                {expense.recipient && (
                                  <span className="text-[11px] text-text-muted font-medium truncate max-w-[140px]" title={`Příjemce: ${expense.recipient}`}>
                                    • {expense.recipient}
                                  </span>
                                )}
                              </div>
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                                <span className="text-[10px] text-text-muted uppercase tracking-wider font-semibold">
                                  {expense.category}
                                </span>
                                {displayPayerName && (
                                  <span className="text-[9px] px-1.5 py-0.5 bg-emerald-50 text-emerald-700/80 rounded border border-emerald-500/20 font-semibold flex items-center gap-1" title={`Platil: ${displayPayerName}`}>
                                    <Coins size={10} className="shrink-0 text-emerald-600" /> Platil: {displayPayerName}
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-4 text-right">
                            <div className="flex flex-col items-end">
                              <span className="font-serif font-bold text-primary whitespace-nowrap">
                                {expense.amount.toLocaleString('cs-CZ')} {expense.currency}
                              </span>
                              <span className={`text-[10px] ${expense.amountInBase === 0 ? 'text-amber-500 italic font-medium' : 'text-text-muted'}`}>
                                {expense.amountInBase === 0 ? 'Čeká na zaúčtování' : `${expense.amountInBase.toLocaleString('cs-CZ', { maximumFractionDigits: 0 })} ${profile.baseCurrency}`}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-4 text-center text-xs text-text-muted font-medium">
                            <span className="inline-block px-2 py-0.5 bg-bg-soft rounded-lg text-text-muted border border-border-subtle/40">
                              {expense.paymentMethod === 'CASH' ? 'Hotovost' : 'Karta'}
                            </span>
                          </td>
                          <td className="pr-4 pl-1 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={(e) => handleDuplicateExpense(expense, e)}
                              disabled={isDuplicatingId === expense.id}
                              title="Kopírovat útratu"
                              className="p-2 rounded-xl text-text-muted hover:text-primary hover:bg-primary/10 transition-all active:scale-95 disabled:opacity-50 inline-flex items-center justify-center cursor-pointer"
                            >
                              {isDuplicatingId === expense.id ? (
                                <Loader2 size={15} className="animate-spin text-primary" />
                              ) : (
                                <Copy size={15} />
                              )}
                            </button>
                          </td>
                        </motion.tr>
                      );
                    })}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          </div>

          {/* Totals Summary */}
          <div className="bg-primary text-primary-content rounded-[28px] sm:rounded-[32px] p-5 sm:p-6 shadow-lg space-y-3.5">
            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-1 border-b border-white/20 pb-3">
              <span className="text-[11px] sm:text-xs font-bold uppercase tracking-widest opacity-80">
                Celkem v měně výletu {filteredExpenses.length < expenses.length && '(filtrováno)'}
              </span>
              <span className="text-xl sm:text-2xl font-serif font-bold">
                {(() => {
                  const totalInBase = filteredExpenses.reduce((acc, e) => acc + e.amountInBase, 0);
                  
                  // Determine display rate
                  const tripCurrencyRates = withdrawals.filter(w => (w.currency || trip.currency) === trip.currency);
                  let displayRate = 0;
                  
                  if (tripCurrencyRates.length > 0) {
                    displayRate = tripCurrencyRates.reduce((sum, w) => sum + w.rate, 0) / tripCurrencyRates.length;
                  } else if (exchangeRates && exchangeRates[trip.currency.toUpperCase()]) {
                    displayRate = 1 / exchangeRates[trip.currency.toUpperCase()];
                  } else if (trip.lastRate) {
                    displayRate = trip.lastRate;
                  }

                  const totalInTripCurrency = displayRate > 0 ? totalInBase / displayRate : 0;
                  return totalInTripCurrency.toLocaleString('cs-CZ', { maximumFractionDigits: 0 });
                })()} {trip.currency}
              </span>
            </div>
            
            <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-1">
              <span className="text-[11px] sm:text-xs font-bold uppercase tracking-widest opacity-80">
                Celkem v základní měně {filteredExpenses.length < expenses.length && '(filtrováno)'}
              </span>
              <span className="text-lg sm:text-xl font-serif font-bold">
                {filteredExpenses
                  .reduce((acc, e) => acc + e.amountInBase, 0)
                  .toLocaleString('cs-CZ', { maximumFractionDigits: 0 })} {profile.baseCurrency}
              </span>
            </div>

            <div className="pt-1.5 border-t border-white/10">
              <p className="text-[10px] opacity-60 italic leading-relaxed">
                * Poznámka: Celkem v měně výletu je přepočteno podle {withdrawals.length > 0 ? 'vašich výběrů' : 'aktuálního kurzu'}. 
                Základní měna zahrnuje vše přepočtené.
              </p>
            </div>
          </div>
        </>
      )}

      {/* Edit Modal */}
      {editingId && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-6">
          <div className="absolute inset-0" onClick={() => setEditingId(null)} />
          <div className="bg-white w-full max-w-md rounded-[28px] sm:rounded-[32px] p-5 sm:p-8 shadow-xl space-y-5 animate-in zoom-in-95 duration-200 max-h-[92vh] overflow-y-auto relative z-10">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-serif text-primary">Upravit útratu</h2>
              <button onClick={() => setEditingId(null)} className="p-2 text-text-muted"><X size={20} /></button>
            </div>

            <div className="space-y-4">
              <div className="space-y-1">
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
                <label className="text-xs font-bold uppercase tracking-widest text-text-muted">Datum</label>
                <div className="flex items-center justify-between bg-bg-soft rounded-2xl p-2 px-4">
                  <button 
                    onClick={() => {
                      const d = editForm.date ? new Date(editForm.date) : new Date();
                      setEditForm({ ...editForm, date: subDays(d, 1).toISOString() });
                    }}
                    className="p-2 rounded-full hover:bg-white/50 text-primary active:scale-90 transition-transform"
                  >
                    <Minus size={16} />
                  </button>
                  
                  <div className="date-input-container relative flex items-center gap-2 px-3 py-2 rounded-xl hover:bg-white/50 cursor-pointer transition-colors group">
                    <Calendar size={16} className="text-primary/40 group-hover:text-primary/70 transition-colors" />
                    <span className="text-sm font-bold text-primary">
                      {editForm.date ? format(new Date(editForm.date), 'd. M. yyyy') : ''}
                    </span>
                    <input
                      type="date"
                      value={editForm.date ? format(new Date(editForm.date), 'yyyy-MM-dd') : ''}
                      onChange={(e) => {
                        if (e.target.value) {
                          const selectedDate = new Date(e.target.value);
                          selectedDate.setHours(12, 0, 0, 0);
                          setEditForm({ ...editForm, date: selectedDate.toISOString() });
                        }
                      }}
                      className="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10"
                      style={{ colorScheme: 'light' }}
                      onClick={(e) => {
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
                    onClick={() => {
                      const d = editForm.date ? new Date(editForm.date) : new Date();
                      setEditForm({ ...editForm, date: addDays(d, 1).toISOString() });
                    }}
                    className="p-2 rounded-full hover:bg-white/50 text-primary active:scale-90 transition-transform"
                  >
                    <Plus size={16} />
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold uppercase tracking-widest text-text-muted">Částka</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={editForm.amount}
                    onChange={(e) => setEditForm({ ...editForm, amount: Number(e.target.value) })}
                    className="flex-1 bg-bg-soft border-none rounded-2xl p-4 focus:ring-2 focus:ring-primary"
                  />
                  <input
                    type="text"
                    value={editForm.currency}
                    onChange={(e) => setEditForm({ ...editForm, currency: e.target.value.toUpperCase() })}
                    className="w-24 bg-bg-soft border-none rounded-2xl p-4 focus:ring-2 focus:ring-primary text-center font-bold"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold uppercase tracking-widest text-text-muted">Popis</label>
                <input
                  type="text"
                  value={editForm.description || ''}
                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  placeholder="Např. Večeře, Vstupné..."
                  className="w-full bg-bg-soft border-none rounded-2xl p-4 focus:ring-2 focus:ring-primary font-medium"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold uppercase tracking-widest text-text-muted">Komu (Příjemce)</label>
                <input
                  type="text"
                  value={editForm.recipient || ''}
                  onChange={(e) => setEditForm({ ...editForm, recipient: e.target.value })}
                  placeholder="Např. Restaurace U Lva, Airbnb, Supermarket..."
                  className="w-full bg-bg-soft border-none rounded-2xl p-4 focus:ring-2 focus:ring-primary font-medium"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold uppercase tracking-widest text-text-muted">Částka v {profile.baseCurrency}</label>
                <input
                  type="number"
                  value={editForm.amountInBase}
                  onChange={(e) => setEditForm({ ...editForm, amountInBase: Number(e.target.value) })}
                  className="w-full bg-bg-soft border-none rounded-2xl p-4 focus:ring-2 focus:ring-primary"
                  placeholder="0.00"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold uppercase tracking-widest text-text-muted">Kurz</label>
                <input
                  type="number"
                  value={editForm.rate}
                  onChange={(e) => setEditForm({ ...editForm, rate: Number(e.target.value) })}
                  className="w-full bg-bg-soft border-none rounded-2xl p-4 focus:ring-2 focus:ring-primary"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold uppercase tracking-widest text-text-muted">Metoda platby</label>
                <select
                  value={editForm.paymentMethod}
                  onChange={(e) => setEditForm({ ...editForm, paymentMethod: e.target.value })}
                  className="w-full bg-bg-soft border-none rounded-2xl p-4 focus:ring-2 focus:ring-primary"
                >
                  {Array.from(new Set(['CASH', ...(profile.paymentMethods || ['KARTA'])])).map(method => (
                    <option key={method} value={method}>{method}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold uppercase tracking-widest text-text-muted">Kategorie</label>
                <select
                  value={editForm.category}
                  onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                  className="w-full bg-bg-soft border-none rounded-2xl p-4 focus:ring-2 focus:ring-primary"
                >
                  {profile.categories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              {trip.people && trip.people.length > 0 && (
                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase tracking-widest text-text-muted">Kdo platil</label>
                  <select
                    value={editForm.paidBy || 'me'}
                    onChange={(e) => setEditForm({ ...editForm, paidBy: e.target.value })}
                    className="w-full bg-bg-soft border-none rounded-2xl p-4 focus:ring-2 focus:ring-primary"
                  >
                    <option value="me">Já (Vlastník / Spolupracovník)</option>
                    {people.filter(p => trip.people?.includes(p.id)).map(person => (
                      <option key={person.id} value={person.id}>{person.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {(profile.showGroupSection || allParticipants.length > 1) && (
                <div className="space-y-2 pt-2 border-t border-bg-soft">
                  <div className="flex items-center justify-between px-1">
                    <label className="text-xs font-bold uppercase tracking-widest text-text-muted flex items-center gap-1">
                      <Users size={14} className="text-primary/70" /> Koho se týká (za koho platí):
                    </label>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setEditForm({ ...editForm, splitBetween: allParticipants.map(p => p.id) })}
                        className="text-[10px] font-bold uppercase tracking-widest text-primary hover:underline cursor-pointer"
                      >
                        Všichni
                      </button>
                      <span className="text-text-muted text-[10px]">•</span>
                      <button
                        type="button"
                        onClick={() => setEditForm({ ...editForm, splitBetween: ['me'] })}
                        className="text-[10px] font-bold uppercase tracking-widest text-primary hover:underline cursor-pointer"
                      >
                        Jen já
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {allParticipants.map(p => {
                      const currentSplits = editForm.splitBetween || allParticipants.map(item => item.id);
                      const isSelected = currentSplits.includes(p.id);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            if (isSelected) {
                              if (currentSplits.length > 1) {
                                setEditForm({ ...editForm, splitBetween: currentSplits.filter(id => id !== p.id) });
                              }
                            } else {
                              setEditForm({ ...editForm, splitBetween: [...currentSplits, p.id] });
                            }
                          }}
                          className={cn(
                            "flex items-center gap-2 px-3 py-2 rounded-2xl text-xs font-bold border transition-all cursor-pointer active:scale-95",
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
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <button
                onClick={handleSaveEdit}
                className="w-full bg-primary text-white py-4 rounded-full font-medium flex items-center justify-center gap-2 active:scale-[0.99] transition-transform cursor-pointer"
              >
                <Save size={20} /> Uložit změny
              </button>
              <button
                type="button"
                onClick={handleDuplicateFromModal}
                disabled={isDuplicatingId === 'modal'}
                className="w-full bg-bg-soft hover:bg-bg-soft/80 text-primary py-3 rounded-2xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 border border-border-subtle/60 active:scale-[0.99] transition-transform cursor-pointer disabled:opacity-50"
              >
                {isDuplicatingId === 'modal' ? (
                  <Loader2 size={16} className="animate-spin text-primary" />
                ) : (
                  <Copy size={16} />
                )}
                Vytvořit kopii záznamu
              </button>
            </div>

            <div className="pt-2 border-t border-bg-soft">
              {confirmDeleteId === editingId ? (
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-center font-bold text-red-500 uppercase tracking-widest">Opravdu smazat?</p>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => handleDelete(editingId)}
                      className="flex-1 bg-red-500 text-white py-3 rounded-2xl font-bold text-sm shadow-md cursor-pointer"
                    >
                      Ano, smazat
                    </button>
                    <button 
                      onClick={() => setConfirmDeleteId(null)}
                      className="flex-1 bg-bg-soft text-text-muted py-3 rounded-2xl font-bold text-sm cursor-pointer"
                    >
                      Zrušit
                    </button>
                  </div>
                </div>
              ) : (
                <button 
                  onClick={() => setConfirmDeleteId(editingId)}
                  className="w-full flex items-center justify-center gap-2 text-red-500 font-bold p-2 hover:bg-red-50 transition-colors rounded-xl text-sm cursor-pointer"
                >
                  <Trash2 size={16} /> Smazat útratu
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Bulk actions bar */}
      <AnimatePresence>
        {selectedIds.size > 0 && (
          <motion.div 
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 w-full max-w-sm px-6"
          >
            <div className="bg-primary text-white p-4 rounded-3xl shadow-2xl flex items-center justify-between border border-white/20 backdrop-blur-md">
              <div className="flex flex-col">
                <span className="text-xs font-bold uppercase tracking-widest opacity-80">Vybráno</span>
                <span className="text-lg font-serif font-bold">{selectedIds.size} útrat</span>
              </div>
              
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => setSelectedIds(new Set())}
                  className="px-4 py-2 text-xs font-bold uppercase tracking-widest hover:bg-white/10 rounded-xl transition-colors"
                >
                  Zrušit
                </button>
                
                {showBulkDeleteConfirm ? (
                  <div className="flex items-center gap-2 animate-in fade-in slide-in-from-right-2 duration-300">
                    <button 
                      onClick={handleBulkDelete}
                      className="bg-red-500 text-white px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest shadow-lg active:scale-95 transition-transform"
                    >
                      Smazat vše
                    </button>
                    <button 
                      onClick={() => setShowBulkDeleteConfirm(false)}
                      className="p-2 hover:bg-white/10 rounded-full transition-colors"
                    >
                      <X size={16} />
                    </button>
                  </div>
                ) : (
                  <button 
                    onClick={() => setShowBulkDeleteConfirm(true)}
                    className="bg-white/20 hover:bg-white/30 text-white p-3 rounded-2xl transition-colors"
                    title="Smazat vybrané"
                  >
                    <Trash2 size={18} />
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Toast notification */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div 
            initial={{ y: -60, opacity: 0, scale: 0.95 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -60, opacity: 0, scale: 0.95 }}
            className="fixed top-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-sm px-6 pointer-events-none"
          >
            <div className="bg-primary text-white p-3.5 px-4 rounded-2xl shadow-xl flex items-center justify-between border border-white/20 backdrop-blur-md pointer-events-auto">
              <div className="flex items-center gap-2.5">
                <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />
                <span className="text-xs font-bold text-white tracking-wide">{toastMessage}</span>
              </div>
              <button 
                onClick={() => setToastMessage(null)}
                className="p-1 hover:bg-white/10 rounded-full transition-colors ml-2 text-white/80 hover:text-white"
              >
                <X size={14} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Import feedback notification */}
      <AnimatePresence>
        {importResult && (
          <motion.div 
            initial={{ y: -100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -100, opacity: 0 }}
            className="fixed top-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-sm px-6"
          >
            <div className={`p-4 rounded-3xl shadow-2xl flex items-center justify-between border backdrop-blur-md ${importResult.error ? 'bg-red-500 text-white border-red-400' : 'bg-green-600 text-white border-green-500'}`}>
              <div className="flex flex-col">
                <span className="text-[10px] font-bold uppercase tracking-widest opacity-80">
                  {importResult.error ? 'Status Importu' : 'Import proběhl v pořádku'}
                </span>
                <span className="text-sm font-bold leading-tight">
                  {importResult.error ? importResult.error : `Nahráno ${importResult.success} záznamů z celkových ${importResult.total}.`}
                </span>
              </div>
              <button 
                onClick={() => setImportResult(null)}
                className="p-2 hover:bg-white/10 rounded-full transition-colors ml-4"
              >
                <X size={20} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
