import { useState } from 'react';
import { genId } from '../utils';
import { toast } from '../ui/Toasts';
import { sanitizeTemplateFields } from '../utils/formPolicy';

/**
 * useTemplateForm — manages template-save UI state and handleSaveTpl logic.
 * A-03: extracted from useCreateRequest.js.
 */
export function useTemplateForm({ type, cat, vName, vNames, vPhone, carPlate, comment, uid, addTemplate }) {
  const [showSaveTpl, setShowSaveTpl] = useState(false);
  const [tplName,     setTplName]     = useState('');

  const handleSaveTpl = () => {
    const sanitized = sanitizeTemplateFields({
      name: tplName,
      visitorName: cat === 'team'
        ? vNames.filter((n) => n.value.trim()).map((n) => n.value).join(', ')
        : vName,
      visitorPhone: vPhone,
      carPlate,
      comment,
    });
    if (!sanitized.name) { toast('Введите название шаблона', 'error'); return; }
    addTemplate(uid, {
      id:          genId('t'),
      name:        sanitized.name,
      type,
      category:    cat,
      visitorName: cat === 'taxi' ? '' : sanitized.visitorName,
      visitorPhone: sanitized.visitorPhone,
      carPlate: sanitized.carPlate,
      comment: sanitized.comment,
    });
    setTplName('');
    setShowSaveTpl(false);
    toast('Шаблон «' + sanitized.name + '» сохранён', 'success');
  };

  return { showSaveTpl, setShowSaveTpl, tplName, setTplName, handleSaveTpl };
}
