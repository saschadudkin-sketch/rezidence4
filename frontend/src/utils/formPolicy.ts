import {
  sanitizeCarPlate,
  sanitizePhone,
  sanitizeText,
  validatePhone,
  validateRequired,
} from './inputSanitizer';

export function sanitizeRequestFormFields({
  visitorName,
  visitorNames,
  visitorPhone,
  carPlate,
  comment,
}: {
  visitorName: string;
  visitorNames: string[];
  visitorPhone: string;
  carPlate: string;
  comment: string;
}) {
  return {
    visitorName: sanitizeText(visitorName),
    visitorNames: visitorNames.map((name) => sanitizeText(name)).filter(Boolean),
    visitorPhone: sanitizePhone(visitorPhone),
    carPlate: sanitizeCarPlate(carPlate),
    comment: sanitizeText(comment),
  };
}

export function sanitizeTemplateFields({
  name,
  visitorName,
  visitorPhone,
  carPlate,
  comment,
}: {
  name: string;
  visitorName: string;
  visitorPhone: string;
  carPlate: string;
  comment: string;
}) {
  return {
    name: sanitizeText(name),
    visitorName: sanitizeText(visitorName),
    visitorPhone: sanitizePhone(visitorPhone),
    carPlate: sanitizeCarPlate(carPlate),
    comment: sanitizeText(comment),
  };
}

export function sanitizeUserFormFields({
  name,
  phone,
  apartment,
  parkingSpot,
}: {
  name: string;
  phone: string;
  apartment: string;
  parkingSpot: string;
}) {
  return {
    name: sanitizeText(name),
    phone: sanitizePhone(phone),
    apartment: sanitizeText(apartment),
    parkingSpot: sanitizeCarPlate(parkingSpot),
  };
}

export function validateUserFormFields({
  name,
  phone,
}: {
  name: string;
  phone: string;
}) {
  const nameErr = validateRequired(name, 'Имя');
  if (nameErr) return nameErr;
  const phoneErr = validatePhone(phone);
  if (phoneErr) return phoneErr;
  return null;
}
