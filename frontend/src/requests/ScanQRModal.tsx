import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useRequests, useActions, useBlacklist } from '../store/AppStore';
import { parsePassQR } from '../services/qrService';
import { validatePass, logVisit } from '../shared/api/passesApi';
import { CAT_LABEL, STS_LABEL } from '../constants/index';
import { getValidationReasonLabel, getStatusToneClass } from '../constants/statusPresentation';
import { normalizeValidationResult } from '../domain/validationResult';
import { getScanDecision } from '../domain/scanDecision';
import { lockScroll, unlockScroll } from '../ui/scrollLock';
import { toast } from '../ui/Toasts';
import { AppIcon } from '../ui/AppIcon';
import { useModalAccessibility } from '../ui/useModalAccessibility';

/**
 * ScanQRModal — сканер QR-кода для охраны.
 * Использует камеру устройства и BarcodeDetector API (Chrome/Edge/Safari).
 * Для браузеров без BarcodeDetector показывает ручной ввод ID.
 */
export function ScanQRModal({ user, onClose }) {
  const requests = useRequests();
  const blacklist = useBlacklist();
  const { approveRequest, rejectRequest, arriveRequest, approveAndArrive } = useActions();
  const [scannedReq, setScannedReq] = useState(null);
  const [validation, setValidation] = useState(null);
  const [checking, setChecking] = useState(false);
  const [scanning, setScanning]     = useState(true);
  const [manualId, setManualId]     = useState('');
  const [camError, setCamError]     = useState(false);
  const [camReady, setCamReady]     = useState(false);
  const videoRef    = useRef(null);
  const { dialogRef, overlayProps } = useModalAccessibility({ onClose });
  const streamRef   = useRef(null);
  const scanRef     = useRef(null);
  const foundRef    = useRef(false);
  const foundReqRef = useRef(null); // snapshot найденной заявки — защита от stale closure
  // FIX [LEAK]: handleManualSearch делает await validateAndSetRequest — модал может закрыться
  const isMountedRef = useRef(true);
  useEffect(() => { isMountedRef.current = true; return () => { isMountedRef.current = false; }; }, []);
  // FIX [PERF]: requestsRef стабилен — не вызывает пересоздание handleScan при обновлении стора
  const requestsRef = useRef(requests);
  requestsRef.current = requests;
  // FIX [PERF]: blacklistRef — blacklist меняет ссылку при каждом обновлении стора,
  // что вызывало пересоздание validateAndSetRequest → handleScan → перезапуск камеры
  const blacklistRef = useRef(blacklist);
  blacklistRef.current = blacklist;

  const stopCamera = useCallback(() => {
    setCamReady(false);
    if (scanRef.current) { clearInterval(scanRef.current); scanRef.current = null; }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  }, []);

  const buildRequestSnapshot = useCallback((req) => ({
    id: req.id,
    type: req.type,
    category: req.category,
    status: req.status,
    visitorName: req.visitorName || null,
    carPlate: req.carPlate || null,
    createdByUid: req.createdByUid || null,
    createdByName: req.createdByName || null,
    createdByApt: req.createdByApt || null,
    createdAt: req.createdAt instanceof Date ? req.createdAt.toISOString() : req.createdAt || null,
    passDuration: req.passDuration || null,
    validUntil: req.validUntil instanceof Date ? req.validUntil.toISOString() : req.validUntil || null,
  }), []);

  const validateAndSetRequest = useCallback(async (found) => {
    // Отменённый пропуск — отклоняем сразу
    if (found.status === 'cancelled') {
      setValidation(normalizeValidationResult({ status: 'denied', reason: 'cancelled' }));
      setScannedReq(found);
      return;
    }
    const passPayload = {
      id:           found.id,
      userId:       found.createdByUid || found.id,
      validUntil:   found.validUntil   || null,
    };
    let result;
    try {
      // zone='entrance' по умолчанию для поста охраны
      result = await validatePass(passPayload, { blacklist: blacklistRef.current });
    } catch {
      result = { status: 'denied', reason: 'error' };
    }
    const normalized = normalizeValidationResult(result);
    setValidation(normalized);
    if (normalized.status === 'denied') {
      await logVisit({
        userId: passPayload.userId,
        requestId: found.id,
        timestamp: new Date().toISOString(),
        result: 'denied',
        reason: normalized.reason,
        actorName: user.name,
        actorRole: user.role,
        visitorName: found.visitorName || null,
        category: found.category,
        createdByApt: found.createdByApt,
        createdByName: found.createdByName,
        createdByUid: found.createdByUid || null,
        requestSnapshot: buildRequestSnapshot(found),
      });
    }
  }, [buildRequestSnapshot, user.name, user.role]); // blacklistRef читается в момент вызова

  const handleScan = useCallback(async (raw) => {
    if (foundRef.current) return; // guard: не обрабатывать повторно
    const data = parsePassQR(raw);
    if (!data) { toast('Неизвестный QR-код', 'error'); return; }
    // FIX [PERF]: используем ref — handleScan не пересоздаётся при каждом обновлении requests
    const found = requestsRef.current.find(r => r.id === data.id);
    if (!found) { toast('Пропуск не найден в системе', 'error'); return; }
    foundRef.current = true;
    foundReqRef.current = found; // сохраняем snapshot до любых async операций
    stopCamera();
    setScanning(false);
    setScannedReq(found);
    setChecking(true);
    await validateAndSetRequest(foundReqRef.current); // используем snapshot
    setChecking(false);
    if (navigator.vibrate) navigator.vibrate(100);
  }, [stopCamera, validateAndSetRequest]); // requestsRef.current читается в момент вызова

  useEffect(() => {
    lockScroll();
    return () => {
      unlockScroll();
      stopCamera();
    };
  }, [stopCamera]);

  // Запускаем камеру
  useEffect(() => {
    if (!scanning) return;
    let cancelled = false;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } }
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
          // FIX [BUG-11]: setCamReady было вне блока if(videoRef.current) из-за
          // неверного отступа — вызывалось даже если videoRef уже null (после unmount)
          setCamReady(true);
        }

        // BarcodeDetector — работает в Chrome, Edge, Safari 17+
        if ('BarcodeDetector' in window) {
          const detector = new (window as Window & { BarcodeDetector: new (opts: { formats: string[] }) => { detect: (img: HTMLVideoElement) => Promise<{ rawValue: string }[]> } }).BarcodeDetector({ formats: ['qr_code'] });
          scanRef.current = setInterval(async () => {
            if (!videoRef.current || videoRef.current.readyState < 2) return;
            try {
              const barcodes = await detector.detect(videoRef.current);
              if (barcodes.length > 0) {
                void handleScan(barcodes[0].rawValue);
              }
            } catch { /* ignore */ }
          }, 300);
        } else {
          // Firefox и другие без BarcodeDetector — камера работает, но автосканирование нет
          if (!cancelled) toast('Автосканирование недоступно — используйте поиск ниже', 'info');
        }
      } catch (e) {
        console.warn('[QR Scanner] camera error:', e);
        if (!cancelled) setCamError(true);
      }
    })();

    return () => { cancelled = true; stopCamera(); };
  }, [scanning, stopCamera, handleScan]);

  const handleManualSearch = async () => {
    const q = manualId.trim().toLowerCase();
    if (!q) return;
    // FIX: используем requestsRef для консистентности
    const found = requestsRef.current.find(r =>
      r.id === q
      || (r.visitorName && r.visitorName.toLowerCase().includes(q))
      || (r.carPlate && r.carPlate.toLowerCase().includes(q))
    );
    if (!found) { toast('Пропуск не найден', 'error'); return; }
    stopCamera();
    setScanning(false);
    setScannedReq(found);
    setChecking(true);
    await validateAndSetRequest(found);
    // FIX [LEAK]: после await модал мог закрыться (охранник нажал ✕ пока шла проверка)
    if (isMountedRef.current) setChecking(false);
  };

  const handleApprove = async () => {
    const decision = getScanDecision({
      requestStatus: scannedReq?.status,
      validationStatus: validation?.status,
    });
    if (!decision.canApprove) {
      toast('Допуск недоступен для этого пропуска', 'error');
      return;
    }

    if (scannedReq.status === 'pending') {
      const dur = scannedReq.passDuration || 'once';
      if (dur === 'once') {
        approveAndArrive(scannedReq.id, user.name, user.role);
        toast('Гость допущен', 'success');
      } else {
        approveRequest(scannedReq.id, user.name, user.role);
        toast('Допуск разрешён', 'success');
      }
    }
    if (scannedReq.status === 'approved') {
      arriveRequest(scannedReq.id, user.name, user.role);
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
        visitorName: scannedReq.visitorName || null,
        category: scannedReq.category,
        createdByApt: scannedReq.createdByApt,
        createdByName: scannedReq.createdByName,
        createdByUid: scannedReq.createdByUid || null,
        requestSnapshot: buildRequestSnapshot(scannedReq),
      });
    } catch (e) {
      console.warn('[ScanQR] logVisit failed:', e);
      // Не блокируем закрытие модала из-за ошибки логирования
    }
    onClose();
  };

  const handleReject = async () => {
    if (scannedReq && scannedReq.status === 'pending') {
      rejectRequest(scannedReq.id, user.name, user.role);
    }
    if (scannedReq) {
      try {
        await logVisit({
          userId: scannedReq.createdByUid || scannedReq.id,
          requestId: scannedReq.id,
          timestamp: new Date().toISOString(),
          result: 'denied',
          reason: 'manual_reject',
          actorName: user.name,
          actorRole: user.role,
          visitorName: scannedReq.visitorName || null,
          category: scannedReq.category,
          createdByApt: scannedReq.createdByApt,
          createdByName: scannedReq.createdByName,
          createdByUid: scannedReq.createdByUid || null,
          requestSnapshot: buildRequestSnapshot(scannedReq),
        });
      } catch (e) {
        console.warn('[ScanQR] logVisit failed:', e);
      }
    }
    toast('В допуске отказано', 'error');
    onClose();
  };

  const { deniedByValidation, canApprove } = getScanDecision({
    requestStatus: scannedReq?.status,
    validationStatus: validation?.status,
  });
  const actionLabel = scannedReq?.status === 'approved' ? 'Отметить вход' : 'Пропустить';
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
                  // FIX [JSX CRITICAL]: два sibling-элемента без Fragment — ошибка сборки Vite/esbuild
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
                <label className="field-lbl">Или введите имя / номер авто / ID</label>
                <div className="u-flex u-gap8">
                  <input className="field-inp u-grow u-mb0"
                    placeholder="Поиск..."
                    value={manualId} onChange={e => setManualId(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleManualSearch()} />
                  <button className="btn-gold u-w-auto scanqr-search-btn"
                    onClick={handleManualSearch}>
                    <span>Найти</span>
                  </button>
                </div>
              </div>
            </>
          )}

          {scannedReq && (
            <div className="qr-result">
              <div className={'qr-result-status ' + getStatusToneClass(scannedReq.status, validation?.status)}>
                <span className="u-inline-icon">
                  <AppIcon name={statusIconName} size={16} />
                </span>
                <span>
                  {checking
                    ? 'Проверяем пропуск...'
                    : deniedByValidation
                      ? 'Доступ запрещён'
                      : canApprove
                    ? (scannedReq.status === 'approved' ? 'Допуск открыт — ожидает входа' : 'Ожидает решения')
                    : STS_LABEL[scannedReq.status] || scannedReq.status}
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
                  <span className="qr-info-val">{CAT_LABEL[scannedReq.category]}</span>
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
                  <button className="btn-no u-flex1" onClick={handleReject}>Отказать</button>
                  <button className="btn-yes scanqr-approve-btn" onClick={handleApprove} disabled={checking}>{actionLabel}</button>
                </>
              ) : (
                <>
                  <button className="btn-outline u-flex1" onClick={() => { setScannedReq(null); setValidation(null); setScanning(true); foundRef.current = false; }}>Сканировать ещё</button>
                  <button className="btn-gold u-flex1" onClick={onClose}><span>Закрыть</span></button>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
