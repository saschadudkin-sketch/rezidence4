import { useState, useRef, useEffect } from 'react';
import { genId } from '../utils';

/**
 * useRequestFormState — manages the raw form field state for CreateModal.
 * Extracted from useCreateRequest as part of God Hook decomposition (КРИТ-A1).
 * Handles: cat, vName, vNames, vPhone, carPlate, comment, validUntil
 */
export function useRequestFormState({ type, user, initialCat, initialData }) {
  const cats = type === 'pass'
    ? (user.role === 'contractor'
        ? ['worker', 'team', 'delivery', 'car']
        : ['guest', 'courier', 'taxi', 'car', 'master'])
    : ['electrician', 'plumber'];

  const initialVisitorNames = typeof initialData?.visitorName === 'string'
    ? initialData.visitorName
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean)
    : [];

  const [cat,        setCat]        = useState(initialData?.category    || initialCat || cats[0]);
  const [vName,      setVName]      = useState(initialData?.visitorName  || '');
  const [vNames,     setVNames]     = useState(() =>
    initialVisitorNames.length > 0
      ? initialVisitorNames.map((name) => ({ __id: genId(), value: name }))
      : [{ __id: genId(), value: '' }]
  );
  const [vPhone,     setVPhone]     = useState(initialData?.visitorPhone || '');
  const [carPlate,   setCarPlate]   = useState(initialData?.carPlate    || '');
  const [apartment,  setApartment]  = useState(initialData?.createdByApt || '');
  const [comment,    setComment]    = useState(initialData?.comment     || '');
  const [validUntil, setValidUntil] = useState(initialData?.validUntil  || '');

  // Reset visitor fields on category change.
  // FIX [REACT]: prev-value ref pattern avoids triggering on mount.
  const prevCatRef = useRef(cat);
  useEffect(() => {
    if (prevCatRef.current === cat) return;
    prevCatRef.current = cat;
    setVName(''); setVPhone(''); setCarPlate('');
    setVNames([{ __id: genId(), value: '' }]);
  }, [cat]);

  return {
    cats,
    cat,        setCat,
    vName,      setVName,
    vNames,     setVNames,
    vPhone,     setVPhone,
    carPlate,   setCarPlate,
    apartment,  setApartment,
    comment,    setComment,
    validUntil, setValidUntil,
  };
}
