export interface UserProfile {
  uid: string;
  email: string;
  displayName?: string;
  photoURL?: string;
  categories: string[];
  paymentMethods?: string[];
  baseCurrency: string;
  theme?: string;
  stayLoggedIn?: boolean;
  showGroupSection?: boolean;
}

export interface Trip {
  id: string;
  ownerId: string;
  name: string;
  currency: string;
  startDate: string;
  endDate?: string;
  lastRate: number;
  duration?: number; // Number of days
  adults?: number;
  children?: number;
  includeSelf?: boolean;
  collaborators?: string[]; // Array of UIDs
  people?: string[]; // Array of Person IDs
  archived?: boolean;
}

export interface Invitation {
  id: string;
  tripId: string;
  tripName: string;
  inviterId: string;
  inviterName: string;
  inviterEmail: string;
  inviteeId?: string;
  inviteeEmail?: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: any;
}

export interface Expense {
  id: string;
  tripId: string;
  ownerId: string;
  date: string;
  amount: number;
  currency: string;
  recipient?: string;
  description: string;
  category: string;
  paymentMethod: string; // Changed from 'CASH' | 'KARTA' to string to support custom cards
  rate: number;
  amountInBase: number;
  createdBy?: string;
  createdByName?: string;
  paidBy?: string;     // Person ID or owner/user ID
  paidByName?: string; // Cache the paid person's name for robust displaying
  splitBetween?: string[]; // Participant IDs (e.g. ['me', 'person_id']) who share the cost of this expense
  _hasPendingWrites?: boolean;
}

export interface Withdrawal {
  id: string;
  tripId: string;
  ownerId: string;
  date: string;
  amount: number;
  currency: string;
  costInBase: number;
  baseCurrency: string;
  accountAmount?: number;
  accountCurrency?: string;
  rate: number;
  location?: string;
  _hasPendingWrites?: boolean;
}

export interface Person {
  id: string;
  ownerId: string;
  name: string;
  email?: string;
  age: number;
  birthDate?: string; // YYYY-MM-DD
}

