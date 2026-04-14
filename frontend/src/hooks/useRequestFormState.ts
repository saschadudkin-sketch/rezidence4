import { useState, useRef, useEffect } from 'react';
import { genId } from '../utils';
import type { AppUser } from '../store/slices/usersSlice';
import type { RequestType } from '../store/slices/requestsSlice';

type FormSeed = Record<string, unknown> | undefined;
type VisitorNameEntry = { __id: string; value: string };

type UseRequestFormStateArgs = {
  type: RequestType;
  user: AppUser;
  initialCat?: string;
  initialData?: FormSeed;
};

function readStringField(seed: FormSeed, key: string): string {
  const value = seed?.[key];
  return typeof value === 'string' ? value : '';
}

export function useRequestFormState({ type, user, initialCat, initialData }: UseRequestFormStateArgs) {
  const cats = type === 'pass'
    ? (user.role === 'contractor'
      ? ['worker', 'team', 'delivery', 'car']
      : ['guest', 'courier', 'taxi', 'car', 'master'])
    : ['electrician', 'plumber'];

  const initialVisitorNames = readStringField(initialData, 'visitorName')
    .split(',')
    .map((name: string) => name.trim())
    .filter(Boolean);

  const initialCategory = readStringField(initialData, 'category') || initialCat || cats[0];
  const [cat, setCat] = useState(initialCategory);
  const [vName, setVName] = useState(readStringField(initialData, 'visitorName'));
  const [vNames, setVNames] = useState<VisitorNameEntry[]>(() =>
    initialVisitorNames.length > 0
      ? initialVisitorNames.map((name: string) => ({ __id: genId(), value: name }))
      : [{ __id: genId(), value: '' }],
  );
  const [vPhone, setVPhone] = useState(readStringField(initialData, 'visitorPhone'));
  const [carPlate, setCarPlate] = useState(readStringField(initialData, 'carPlate'));
  const [apartment, setApartment] = useState(readStringField(initialData, 'createdByApt'));
  const [comment, setComment] = useState(readStringField(initialData, 'comment'));
  const [validUntil, setValidUntil] = useState(readStringField(initialData, 'validUntil'));

  const prevCatRef = useRef(cat);
  useEffect(() => {
    if (prevCatRef.current === cat) return;
    prevCatRef.current = cat;
    setVName('');
    setVPhone('');
    setCarPlate('');
    setVNames([{ __id: genId(), value: '' }]);
  }, [cat]);

  return {
    cats,
    cat, setCat,
    vName, setVName,
    vNames, setVNames,
    vPhone, setVPhone,
    carPlate, setCarPlate,
    apartment, setApartment,
    comment, setComment,
    validUntil, setValidUntil,
  };
}
