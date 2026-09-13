
export interface CurrencyInfo {
  code: string;
  name: string;
  country: string;
  flag?: string;
}

export const CURRENCIES: CurrencyInfo[] = [
  { code: 'CZK', name: 'Česká koruna', country: 'Česká republika' },
  { code: 'EUR', name: 'Euro', country: 'Evropská unie' },
  { code: 'USD', name: 'Americký dolar', country: 'USA' },
  { code: 'GBP', name: 'Britská libra', country: 'Velká Británie' },
  { code: 'PLN', name: 'Zlotý', country: 'Polsko' },
  { code: 'HUF', name: 'Forint', country: 'Maďarsko' },
  { code: 'HRK', name: 'Kuna', country: 'Chorvatsko' },
  { code: 'BGN', name: 'Lev', country: 'Bulharsko' },
  { code: 'RON', name: 'Leu', country: 'Rumunsko' },
  { code: 'TRY', name: 'Lira', country: 'Turecko' },
  { code: 'EGP', name: 'Libra', country: 'Egypt' },
  { code: 'THB', name: 'Baht', country: 'Thajsko' },
  { code: 'VND', name: 'Dong', country: 'Vietnam' },
  { code: 'IDR', name: 'Rupie', country: 'Indonésie' },
  { code: 'AED', name: 'Dirham', country: 'SAE' },
  { code: 'CHF', name: 'Frank', country: 'Švýcarsko' },
  { code: 'AUD', name: 'Dolar', country: 'Austrálie' },
  { code: 'CAD', name: 'Dolar', country: 'Kanada' },
  { code: 'JPY', name: 'Jen', country: 'Japonsko' },
  { code: 'CNY', name: 'Jüan', country: 'Čína' },
  { code: 'INR', name: 'Rupie', country: 'Indie' },
  { code: 'BRL', name: 'Real', country: 'Brazílie' },
  { code: 'MXN', name: 'Peso', country: 'Mexiko' },
  { code: 'ILS', name: 'Šekel', country: 'Izrael' },
  { code: 'NOK', name: 'Koruna', country: 'Norsko' },
  { code: 'SEK', name: 'Koruna', country: 'Švédsko' },
  { code: 'DKK', name: 'Koruna', country: 'Dánsko' },
  { code: 'ISK', name: 'Koruna', country: 'Island' },
  { code: 'NZD', name: 'Dolar', country: 'Nový Zéland' },
  { code: 'SGD', name: 'Dolar', country: 'Singapur' },
  { code: 'HKD', name: 'Dolar', country: 'Hongkong' },
  { code: 'ZAR', name: 'Rand', country: 'JAR' },
  { code: 'LKR', name: 'Rupie', country: 'Srí Lanka' },
  { code: 'MYR', name: 'Ringgit', country: 'Malajsie' },
  { code: 'PHP', name: 'Peso', country: 'Filipíny' },
  { code: 'TWD', name: 'Dolar', country: 'Tchaj-wan' },
  { code: 'KRW', name: 'Won', country: 'Jižní Korea' },
  { code: 'SAR', name: 'Rijál', country: 'Saúdská Arábie' },
  { code: 'QAR', name: 'Rijál', country: 'Katar' },
  { code: 'KWD', name: 'Dinár', country: 'Kuvajt' },
  { code: 'BHD', name: 'Dinár', country: 'Bahrajn' },
  { code: 'OMR', name: 'Rijál', country: 'Omán' },
  { code: 'JOD', name: 'Dinár', country: 'Jordánsko' },
  { code: 'MAD', name: 'Dirham', country: 'Maroko' },
  { code: 'TND', name: 'Dinár', country: 'Tunisko' },
  { code: 'GEL', name: 'Lari', country: 'Gruzie' },
  { code: 'AMD', name: 'Dram', country: 'Arménie' },
  { code: 'AZN', name: 'Manat', country: 'Ázerbájdžán' },
  { code: 'KZT', name: 'Tenge', country: 'Kazachstán' },
  { code: 'MVR', name: 'Rufiyaa', country: 'Maledivy' },
  { code: 'MUR', name: 'Rupie', country: 'Mauricius' },
  { code: 'SCR', name: 'Rupie', country: 'Seychely' },
  { code: 'KES', name: 'Šilink', country: 'Keňa' },
  { code: 'TZS', name: 'Šilink', country: 'Tanzanie' },
  { code: 'UGX', name: 'Šilink', country: 'Uganda' },
  { code: 'ETB', name: 'Birr', country: 'Etiopie' },
  { code: 'GHS', name: 'Cedi', country: 'Ghana' },
  { code: 'NGN', name: 'Naira', country: 'Nigérie' },
  { code: 'ARS', name: 'Peso', country: 'Argentina' },
  { code: 'CLP', name: 'Peso', country: 'Chile' },
  { code: 'COP', name: 'Peso', country: 'Kolumbie' },
  { code: 'PEN', name: 'Sol', country: 'Peru' },
  { code: 'UYU', name: 'Peso', country: 'Uruguay' },
  { code: 'DOP', name: 'Peso', country: 'Dominikánská rep.' },
  { code: 'CRC', name: 'Colón', country: 'Kostarika' },
  { code: 'PAB', name: 'Balboa', country: 'Panama' },
  { code: 'GTQ', name: 'Quetzal', country: 'Guatemala' },
  { code: 'HNL', name: 'Lempira', country: 'Honduras' },
  { code: 'NIO', name: 'Córdoba', country: 'Nikaragua' },
  { code: 'SVC', name: 'Colón', country: 'Salvador' },
  { code: 'BOB', name: 'Boliviano', country: 'Bolívie' },
  { code: 'PYG', name: 'Guaraní', country: 'Paraguay' },
  { code: 'UAH', name: 'Hřivna', country: 'Ukrajina' },
  { code: 'RSD', name: 'Dinár', country: 'Srbsko' },
  { code: 'ALL', name: 'Lek', country: 'Albánie' },
  { code: 'MKD', name: 'Denár', country: 'Makedonie' },
  { code: 'BAM', name: 'Marka', country: 'Bosna a Herc.' },
  { code: 'MDL', name: 'Leu', country: 'Moldavsko' },
  { code: 'BYN', name: 'Rubl', country: 'Bělorusko' },
  { code: 'RUB', name: 'Rubl', country: 'Rusko' },
];

export async function fetchExchangeRates(baseCurrency: string) {
  try {
    const response = await fetch(`https://open.er-api.com/v6/latest/${baseCurrency}`);
    const data = await response.json();
    if (data.result === 'success') {
      // Cache the successful result
      localStorage.setItem(`rates_${baseCurrency.toUpperCase()}`, JSON.stringify(data.rates));
      return data.rates as Record<string, number>;
    }
    throw new Error('Failed to fetch rates');
  } catch (error) {
    console.error('Error fetching exchange rates:', error);
    // Try to load from cache
    const cached = localStorage.getItem(`rates_${baseCurrency.toUpperCase()}`);
    if (cached) {
      console.log('Using cached rates for', baseCurrency);
      return JSON.parse(cached) as Record<string, number>;
    }
    return null;
  }
}

export async function fetchSingleRate(from: string, to: string) {
  try {
    const rates = await fetchExchangeRates(from);
    if (rates && rates[to]) {
      return rates[to];
    }
    // Try reverse if not found
    const reverseRates = await fetchExchangeRates(to);
    if (reverseRates && reverseRates[from]) {
      return 1 / reverseRates[from];
    }
    return null;
  } catch (error) {
    return null;
  }
}
