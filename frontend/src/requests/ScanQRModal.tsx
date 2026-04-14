import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useRequests, useActions, useBlacklist } from '../store/AppStore';
import type { AppRequest } from '../store/slices/requestsSlice';
import type { AppUser } from '../store/slices/usersSlice';
import { parsePassQR } from '../services/qrService';
import { validatePass, logVisit } from '../shared/api/passesApi';
import { CAT_LABEL, STS_LABEL } from '../constants/index';
import { getValidationReasonLabel, getStatusToneClass } from '../constants/statusPresentation';
import { normalizeValidationResult, type ValidationResult } from '../domain/validationResult';
import { getScanDecision } from '../domain/scanDecision';
import { lockScroll, unlockScroll } from '../ui/scrollLock';
import { toast } from '../ui/Toasts';
import { AppIcon } from '../ui/AppIcon';
import { useModalAccessibility } from '../ui/useModalAccessibility';

type ScanQRModalProps = {
  user: Pick<AppUser, 'uid' | 'name' | 'role'>;
  onClose: () => void;
};

type BarcodeDetectorResult = { rawValue: string };
type BarcodeDetectorLike = {
  detect: (image: HTMLVideoElement) => Promise<BarcodeDetectorResult[]>;
};
type BarcodeDetectorCtor = new (opts: { formats: string[] }) => BarcodeDetectorLike;
type BarcodeWindow = Window & { BarcodeDetector?: BarcodeDetectorCtor };
type RequestSnapshot = Record<string, unknown>;

function getCategoryLabel(category?: string): string {
  return category && category in CAT_LABEL
    ? CAT_LABEL[category as keyof typeof CAT_LABEL]
    : category ?? 'Пропуск';
}

function getStatusLabel(status?: string): string {
  return status && status in STS_LABEL
    ? STS_LABEL[status as keyof typeof STS_LABEL]
    : status ?? 'Неизвестно';
}

function toValidationTone(status?: ValidationResult['status'] | null): 'denied' | 'ok' | undefined {
  if (status === 'denied') return 'denied';
  if (status === 'allowed') return 'ok';
  return undefined;
}

function resetForNextScan(
  setScannedReq: (value: AppRequest | null) => void,
  setValidation: (value: ValidationResult | null) => void,
  setChecking: (value: boolean) => void,
  setScanning: (value: boolean) => void,
  foundRef: React.MutableRefObject<boolean>,
) {
  setScannedReq(null);
  setValidation(null);
  setChecking(false);
  setScanning(true);
  foundRef.current = false;
}

export function ScanQRModal({ user, onClose }: ScanQRModalProps) {
  const requests = useRequests();
  const blacklist = useBlacklist();
  const { rejectRequest, arriveRequest, approveAndArrive } = useActions();
  const [scannedReq, setScannedReq] = useState<AppRequest | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [scanning, setScanning] = useState(true);
  const [manualId, setManualId] = useState('');
  const [camError, setCamError] = useState(false);
  const [camReady, setCamReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const { dialogRef, overlayProps } = useModalAccessibility({ onClose });
  const streamRef = useRef<MediaStream | null>(null);
  const scanRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const foundRef = useRef(false);
  const foundReqRef = useRef<AppRequest | null>(null);
  const isMountedRef = useRef(true);
  const requestsRef = useRef<AppRequest[]>(requests);
  const blacklistRef = useRef(blacklist);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  requestsRef.current = requests;
  blacklistRef.current = blacklist;

  const stopCamera = useCallback(() => {
    setCamReady(false);
    if (scanRef.current) {
      clearInterval(scanRef.current);
      scanRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  const buildRequestSnapshot = useCallback((req: AppRequest): RequestSnapshot => ({
    id: req.id,
    type: req.type,
    category: req.category ?? null,
    status: req.status,
    visitorName: req.visitorName ?? null,
    carPlate: req.carPlate ?? null,
    createdByUid: req.createdByUid ?? null,
    createdByName: req.createdByName ?? null,
    createdByApt: req.createdByApt ?? null,
    createdAt: req.createdAt instanceof Date ? req.createdAt.toISOString() : req.createdAt ?? null,
    passDuration: req.passDuration ?? null,
    validUntil: req.validUntil instanceof Date ? req.validUntil.toISOString() : req.validUntil ?? null,
  }), []);

  const validateAndSetRequest = useCallback(async (found: AppRequest) => {
    if (found.status === 'cancelled') {
      setValidation(normalizeValidationResult({ status: 'denied', reason: 'cancelled' }));
      setScannedReq(found);
      return;
    }

    const passPayload = {
      id: found.id,
      userId: found.createdByUid || found.id,
      validUntil: found.validUntil || null,
    };

    let result: ValidationResult;
    try {
      result = normalizeValidationResult(
        await validatePass(passPayload, { blacklist: blacklistRef.current }),
      );
    } catch {
      result = normalizeValidationResult({ status: 'denied', reason: 'error' });
    }

    setValidation(result);
    if (result.status === 'denied') {
      await logVisit({
        userId: passPayload.userId,
        requestId: found.id,
        timestamp: new Date().toISOString(),
        result: 'denied',
        reason: result.reason,
        actorName: user.name,
        actorRole: user.role,
        visitorName: found.visitorName ?? null,
        category: found.category,
        createdByApt: found.createdByApt,
        createdByName: found.createdByName,
        createdByUid: found.createdByUid ?? null,
        requestSnapshot: buildRequestSnapshot(found),
      });
    }
  }, [buildRequestSnapshot, user.name, user.role]);

  const handleScan = useCallback(async (raw: string) => {
    if (foundRef.current) return;
    const data = parsePassQR(raw);
    if (!data) {
      toast('Неизвестный QR-код', 'error');
      return;
    }

    const found = requestsRef.current.find((req) => req.id === data.id);
    if (!found) {
      toast('Пропуск не найден в системе', 'error');
      return;
    }

    foundRef.current = true;
    foundReqRef.current = found;
    stopCamera();
    setScanning(false);
    setScannedReq(found);
    setChecking(true);
    await validateAndSetRequest(found);
    if (isMountedRef.current) setChecking(false);
    if (navigator.vibrate) navigator.vibrate(100);
  }, [stopCamera, validateAndSetRequest]);

  useEffect(() => {
    lockScroll();
    return () => {
      unlockScroll();
      stopCamera();
    };
  }, [stopCamera]);

  useEffect(() => {
    if (!scanning) return;
    let cancelled = false;

    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setCamReady(true);
        }

        const barcodeWindow = window as BarcodeWindow;
        if (barcodeWindow.BarcodeDetector) {
          const detector = new barcodeWindow.BarcodeDetector({ formats: ['qr_code'] });
          scanRef.current = setInterval(async () => {
            if (!videoRef.current || videoRef.current.readyState < 2) return;
            try {
              const barcodes = await detector.detect(videoRef.current);
              if (barcodes.length > 0) void handleScan(barcodes[0].rawValue);
            } catch {
              // ignore camera scan frames that cannot be decoded
            }
          }, 300);
        } else if (!cancelled) {
          toast('Автосканирование недоступно, используйте поиск ниже', 'info');
        }
      } catch (error) {
        console.warn('[QR Scanner] camera error:', error);
        if (!cancelled) setCamError(true);
      }
    })();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [scanning, stopCamera, handleScan]);

  const handleManualSearch = async () => {
    const query = manualId.trim().toLowerCase();
    if (!query) return;

    const found = requestsRef.current.find((req) =>
      req.id === query
      || (typeof req.visitorName === 'string' && req.visitorName.toLowerCase().includes(query))
      || (typeof req.carPlate === 'string' && req.carPlate.toLowerCase().includes(query))
      || (typeof req.createdByApt === 'string' && req.createdByApt.toLowerCase().includes(query))
      || (typeof req.createdByName === 'string' && req.createdByName.toLowerCase().includes(query)),
    );

    if (!found) {
      toast('Пропуск не найден', 'error');
      return;
    }

    stopCamera();
    setScanning(false);
    setScannedReq(found);
    setChecking(true);
    await validateAndSetRequest(found);
    if (isMountedRef.current) setChecking(false);
  };

  const handleApprove = async () => {
    if (!scannedReq) return;

    const decision = getScanDecision({
      requestStatus: scannedReq.status,
      validationStatus: validation?.status ?? '',
    });
    if (!decision.canApprove) {
      toast('Допуск недоступен для этого пропуска', 'error');
      return;
    }

    if (scannedReq.status === 'pending') {
      await Promise.resolve(approveAndArrive(scannedReq.id, user.name, user.role));
      toast('Вход отмечен', 'success');
    } else if (scannedReq.status === 'approved') {
      await Promise.resolve(arriveRequest(scannedReq.id, user.name, user.role));
      toast('Вход отмечен', 'success');
    }

    try {
      await logVisit({
        userId: scannedReq.createdByUid || scannedReq.id,
        requestId: scannedReq.id,
        timestamp: new Date().toISOString(),
        result: 'allowed',
        reason: 'ok',
        actorName: user.name,
        actorRole: user.role,
        visitorName: scannedReq.visitorName ?? null,
        category: scannedReq.category,
        createdByApt: scannedReq.createdByApt,
        createdByName: scannedReq.createdByName,
        createdByUid: scannedReq.createdByUid ?? null,
        requestSnapshot: buildRequestSnapshot(scannedReq),
      });
    } catch (error) {
      console.warn('[ScanQR] logVisit failed:', error);
    }

    onClose();
  };

  const handleReject = async () => {
    if (!scannedReq) return;

    if (scannedReq.status === 'pending' || scannedReq.status === 'approved') {
      await Promise.resolve(rejectRequest(scannedReq.id, user.name, user.role));
    }

    try {
      await logVisit({
        userId: scannedReq.createdByUid || scannedReq.id,
        requestId: scannedReq.id,
        timestamp: new Date().toISOString(),
        result: 'denied',
        reason: 'manual_reject',
        actorName: user.name,
        actorRole: user.role,
        visitorName: scannedReq.visitorName ?? null,
        category: scannedReq.category,
        createdByApt: scannedReq.createdByApt,
        createdByName: scannedReq.createdByName,
        createdByUid: scannedReq.createdByUid ?? null,
        requestSnapshot: buildRequestSnapshot(scannedReq),
      });
    } catch (error) {
      console.warn('[ScanQR] logVisit failed:', error);
    }

    toast('В допуске отказано', 'error');
    onClose();
  };

  const { deniedByValidation, canApprove } = getScanDecision({
    requestStatus: scannedReq?.status ?? '',
    validationStatus: validation?.status ?? '',
  });
  const actionLabel = 'Отметить вход';
  const validationReason = getValidationReasonLabel(validation?.reason);
  const statusIconName = checking
    ? 'history'
    : canApprove
      ? 'check'
      : deniedByValidation || scannedReq?.status === 'rejected'
        ? 'denied'
        : 'alert';

  return createPortal(
    <div className="overlay" {...overlayProps}>
      <div className="modal" ref={dialogRef} role="dialog" aria-modal="true" tabIndex={-1}>
        <div className="modal-handle" />
        <div className="modal-head">
          <span className="modal-title">{scanning ? 'Сканировать QR' : 'Результат проверки'}</span>
          <button className="modal-close" onClick={onClose} aria-label="Закрыть"><AppIcon name="close" size={14} /></button>
        </div>
        <div className="modal-body">
          {scanning && (
            <>
              <div className="qr-scanner-viewport">
                {camError ? (
                  <div className="qr-scanner-fallback">
                    <div className="u-inline-icon scanqr-cam-icon"><AppIcon name="camera" size={30} /></div>
                    <div className="u-fs13 u-t3 u-mb4">Камера недоступна</div>
                    <div className="u-fs11 u-t4">Используйте поиск ниже</div>
                  </div>
                ) : (
                  <>
                    <video ref={videoRef} className="qr-scanner-video" playsInline muted />
                    {!camReady && (
                      <div className="qr-cam-loading">
                        <div className="qr-cam-spinner" />
                        <div className="u-fs12 u-t4 scanqr-cam-init">Инициализация камеры...</div>
                      </div>
                    )}
                  </>
                )}
                <div className="qr-scanner-frame" />
              </div>
              <div className="field u-mt16">
                <label className="field-lbl">Или введите имя / авто / апартамент / ID</label>
                <div className="u-flex u-gap8">
                  <input
                    className="field-inp u-grow u-mb0"
                    placeholder="Имя, авто, апарт. или ID"
                    value={manualId}
                    onChange={(event) => setManualId(event.target.value)}
                    onKeyDown={(event) => event.key === 'Enter' && void handleManualSearch()}
                  />
                  <button className="btn-gold u-w-auto scanqr-search-btn" onClick={() => void handleManualSearch()}>
                    <span>Найти</span>
                  </button>
                </div>
              </div>
            </>
          )}

          {scannedReq && (
            <div className="qr-result">
              <div className={'qr-result-status ' + getStatusToneClass(scannedReq.status, toValidationTone(validation?.status))}>
                <span className="u-inline-icon">
                  <AppIcon name={statusIconName} size={16} />
                </span>
                <span>
                  {checking
                    ? 'Проверяем пропуск...'
                    : deniedByValidation
                      ? 'Доступ запрещён'
                      : canApprove
                        ? 'Допуск открыт - ожидает входа'
                        : getStatusLabel(scannedReq.status)}
                </span>
              </div>
              {validationReason && (
                <div className="u-fs12 u-err u-mb10 u-fw600">
                  {validationReason}
                </div>
              )}
              <div className="qr-result-details">
                <div className="qr-info-row">
                  <span className="qr-info-lbl">Тип</span>
                  <span className="qr-info-val">{getCategoryLabel(scannedReq.category)}</span>
                </div>
                {scannedReq.visitorName && (
                  <div className="qr-info-row">
                    <span className="qr-info-lbl">Посетитель</span>
                    <span className="qr-info-val u-fw600 u-fs15">{scannedReq.visitorName}</span>
                  </div>
                )}
                {scannedReq.carPlate && (
                  <div className="qr-info-row">
                    <span className="qr-info-lbl">Авто</span>
                    <span className="qr-info-val u-fw600">{scannedReq.carPlate}</span>
                  </div>
                )}
                <div className="qr-info-row">
                  <span className="qr-info-lbl">К кому</span>
                  <span className="qr-info-val">Апарт. {scannedReq.createdByApt} · {scannedReq.createdByName}</span>
                </div>
                {scannedReq.comment && (
                  <div className="qr-info-row">
                    <span className="qr-info-lbl">Комментарий</span>
                    <span className="qr-info-val">{scannedReq.comment}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="modal-foot">
          {scanning ? (
            <button className="btn-outline u-flex1" onClick={onClose}>Отмена</button>
          ) : (
            <>
              {canApprove ? (
                <>
                  <button className="btn-no u-flex1" onClick={() => void handleReject()}>Отказать</button>
                  <button className="btn-yes scanqr-approve-btn" onClick={() => void handleApprove()} disabled={checking}>{actionLabel}</button>
                </>
              ) : (
                <>
                  <button
                    className="btn-outline u-flex1"
                    onClick={() => resetForNextScan(setScannedReq, setValidation, setChecking, setScanning, foundRef)}
                  >
                    Сканировать ещё
                  </button>
                  <button className="btn-gold u-flex1" onClick={onClose}><span>Закрыть</span></button>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
