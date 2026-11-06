// Elenco dei fornitori AI collegabili. Per aggiungerne uno basta un adattatore
// con listModels / generate / generateJSON e una voce qui sotto.
import * as gemini from './gemini.js?v=2.6.0';
import * as anthropic from './anthropic.js?v=2.6.0';
import { make } from './openai.js?v=2.6.0';

export const PROVIDERS = {
  gemini: {
    id: 'gemini', name: 'Google Gemini', adapter: gemini,
    price: 'Gratuito, con limiti giornalieri. Non serve la carta di credito.',
    keyUrl: 'https://aistudio.google.com/apikey', site: 'Google AI Studio',
    steps: ['Accedi con il tuo account Google.', 'Tocca <strong>Create API key</strong> (Crea chiave API) e copiala.'],
    privacy: 'Con il piano gratuito Google può usare le conversazioni per migliorare i suoi servizi; nell\'Unione europea potrebbero valere regole più protettive.',
  },
  openrouter: {
    id: 'openrouter', name: 'OpenRouter', adapter: make({ id: 'openrouter', name: 'OpenRouter', base: 'https://openrouter.ai/api/v1', headers: { 'X-Title': 'Spazio personale' } }),
    price: 'Molti modelli, alcuni gratuiti (circa 50 richieste al giorno; 1.000 dopo un acquisto unico di 10 $).',
    keyUrl: 'https://openrouter.ai/keys', site: 'OpenRouter',
    steps: ['Crea un account.', 'In <strong>Keys</strong> tocca <strong>Create key</strong> e copiala.'],
    privacy: 'Per i modelli gratuiti dipende da chi li ospita: alcuni conservano i messaggi. Controlla le impostazioni privacy di OpenRouter.',
  },
  anthropic: {
    id: 'anthropic', name: 'Claude (Anthropic)', adapter: anthropic,
    price: 'A pagamento con credito prepagato: con Claude Haiku circa 0,50–1,30 $ al mese per un uso personale.',
    keyUrl: 'https://console.anthropic.com/settings/keys', site: 'Console di Anthropic',
    steps: ['Crea un account e aggiungi un po\' di credito (bastano 5 $ per mesi).', 'Tocca <strong>Create Key</strong> e copiala.'],
    privacy: 'Le conversazioni fatte via API non vengono usate per addestrare i modelli.',
  },
  openai: {
    id: 'openai', name: 'OpenAI', adapter: make({ id: 'openai', name: 'OpenAI', base: 'https://api.openai.com/v1' }),
    price: 'A pagamento con credito prepagato: con GPT-5 mini circa 1,40–3,60 $ al mese.',
    keyUrl: 'https://platform.openai.com/api-keys', site: 'OpenAI Platform',
    steps: ['Crea un account e aggiungi credito.', 'Tocca <strong>Create new secret key</strong> e copiala.'],
    privacy: 'Le conversazioni fatte via API non vengono usate per addestrare i modelli.',
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS);
