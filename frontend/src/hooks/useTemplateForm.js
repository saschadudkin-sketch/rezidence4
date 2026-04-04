import { useState } from 'react';
import { genId } from '../utils.js';
import { toast } from '../ui/Toasts';

/**
 * useTemplateForm — manages template-save UI state and handleSaveTpl logic.
 * A-03: extracted from useCreateRequest.js.
 */
export function useTemplateForm({ type, cat, vName, vNames, vPhone, carPlate, comment, uid, addTemplate }) {
  const [showSaveTpl, setShowSaveTpl] = useState(false);
  const [tplName,     setTplName]     = useState('');

  const handleSaveTpl = () => {
    if (!tplName.trim()) { toast('Введите название шаблона', 'error'); return; }
    addTemplate(uid, {
      id:          genId('t'),
      name:        tplName.trim(),
      type,
      category:    cat,
      visitorName: cat === 'taxi' ? '' : cat === 'team'
                     ? vNames.filter(n => n.value.trim()).map(n => n.value).join(', ')
                     : vName,
      visitorPhone: vPhone,
      carPlate,
      comment,
    });
    setTplName('');
    setShowSaveTpl(false);
    toast('Шаблон «' + tplName.trim() + '» сохранён', 'success');
  };

  return { showSaveTpl, setShowSaveTpl, tplName, setTplName, handleSaveTpl };
}
