import type { QRCodeModule } from 'qrcode';
import type { AppRequest, RequestType } from '../store/slices/requestsSlice';

type PassQrPayload = {
  id: string;
  type: RequestType;
  category: string | null;
  visitorName: string;
  createdByApt: string;
  createdByName: string;
  carPlate: string | null;
  passDuration: AppRequest['passDuration'] | 'once';
  validUntil: string | null;
  createdAt: string | Date;
};

let qrCodeModule: QRCodeModule | null = null;

async function getQRCode(): Promise<QRCodeModule> {
  if (!qrCodeModule) {
    qrCodeModule = (await import('qrcode')).default;
  }
  return qrCodeModule;
}

export async function generatePassQR(req: AppRequest): Promise<string> {
  const QRCode = await getQRCode();
  const payload: PassQrPayload = {
    id: req.id,
    type: req.type,
    category: req.category ?? null,
    visitorName: req.visitorName || '—',
    createdByApt: req.createdByApt || '—',
    createdByName: req.createdByName || '—',
    carPlate: req.carPlate || null,
    passDuration: req.passDuration || 'once',
    validUntil: req.validUntil instanceof Date ? req.validUntil.toISOString() : (req.validUntil || null),
    createdAt: req.createdAt instanceof Date ? req.createdAt.toISOString() : req.createdAt,
  };

  return QRCode.toDataURL(JSON.stringify(payload), {
    width: 256,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: {
      dark: '#1C1A16',
      light: '#FAF8F4',
    },
  });
}

export function parsePassQR(raw: string): PassQrPayload | null {
  try {
    const data = JSON.parse(raw) as Partial<PassQrPayload>;
    if (!data.id || !data.type) return null;
    return data as PassQrPayload;
  } catch {
    return null;
  }
}
