import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import enCommon from './locales/en/common.json';
import enFilters from './locales/en/filters.json';
import enLogs from './locales/en/logs.json';
import enDialogs from './locales/en/dialogs.json';
import enCommands from './locales/en/commands.json';

import esCommon from './locales/es/common.json';
import esFilters from './locales/es/filters.json';
import esLogs from './locales/es/logs.json';
import esDialogs from './locales/es/dialogs.json';
import esCommands from './locales/es/commands.json';

export const defaultNS = 'common';
export const resources = {
  en: {
    common: enCommon,
    filters: enFilters,
    logs: enLogs,
    dialogs: enDialogs,
    commands: enCommands,
  },
  es: {
    common: esCommon,
    filters: esFilters,
    logs: esLogs,
    dialogs: esDialogs,
    commands: esCommands,
  },
} as const;

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    defaultNS,
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      caches: ['localStorage'],
    },
  });

export default i18n;
