import { useState } from 'react';
import { genId } from '../utils';
import { toast } from '../ui/Toasts';
import { sanitizeTemplateFields } from '../utils/formPolicy';
import type { Template } from '../store/slices/permsSlice';

type VisitorNameEntry = { __id: string; value: string };

type UseTemplateFormArgs = {
  type: string;
  cat: string;
  vName: string;
  vNames: VisitorNameEntry[];
  vPhone: string;
  carPlate: string;
  comment: string;
  uid: string;
  addTemplate: (uid: string, template: Template) => void;
};

export function useTemplateForm({ type, cat, vName, vNames, vPhone, carPlate, comment, uid, addTemplate }: UseTemplateFormArgs) {
  const [showSaveTpl, setShowSaveTpl] = useState(false);
  const [tplName, setTplName] = useState('');

  const handleSaveTpl = () => {
    const sanitized = sanitizeTemplateFields({
      name: tplName,
      visitorName: cat === 'team'
        ? vNames.filter((entry) => entry.value.trim()).map((entry) => entry.value).join(', ')
        : vName,
      visitorPhone: vPhone,
      carPlate,
      comment,
    });

    if (!sanitized.name) {
      toast('Введите название шаблона', 'error');
      return;
    }

    addTemplate(uid, {
      id: genId('t'),
      name: sanitized.name,
      type,
      category: cat,
      visitorName: cat === 'taxi' ? '' : sanitized.visitorName,
      visitorPhone: sanitized.visitorPhone,
      carPlate: sanitized.carPlate,
      comment: sanitized.comment,
    });
    setTplName('');
    setShowSaveTpl(false);
    toast(`Шаблон «${sanitized.name}» сохранён`, 'success');
  };

  return { showSaveTpl, setShowSaveTpl, tplName, setTplName, handleSaveTpl };
}
