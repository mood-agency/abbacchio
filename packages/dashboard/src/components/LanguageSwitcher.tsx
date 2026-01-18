import { useTranslation } from 'react-i18next';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const languages = [
  { code: 'en', label: 'EN', name: 'English' },
  { code: 'es', label: 'ES', name: 'Español' },
] as const;

export function LanguageSwitcher() {
  const { i18n } = useTranslation();

  const currentLang = languages.find(
    (l) => l.code === i18n.language.split('-')[0]
  );

  return (
    <Select
      value={i18n.language.split('-')[0]}
      onValueChange={(value) => i18n.changeLanguage(value)}
    >
      <SelectTrigger className="w-14 h-8 px-2">
        <SelectValue>{currentLang?.label}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {languages.map((lang) => (
          <SelectItem key={lang.code} value={lang.code}>
            <span className="flex items-center gap-2">
              <span className="font-medium">{lang.label}</span>
              <span className="text-muted-foreground">{lang.name}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
