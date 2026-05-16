'use strict';

const express = require('express');
const request = require('supertest');
const publicPassRouter = require('../routes/publicPass');
const { encryptCredentialSecret } = require('../v1/services/passCredentialService');

function buildApp(db, property = { name: 'ЖК Замоскворечье' }) {
  const app = express();
  app.use((req, _res, next) => {
    req.db = db;
    req.property = property;
    next();
  });
  app.use('/api/v1/public/pass', publicPassRouter);
  return app;
}

describe('publicPass route v1 cutover', () => {
  test('serves platform-v1 credential public-safe payload for 32-hex token', async () => {
    const db = {
      query: jest.fn(async (sql) => {
        expect(sql).toContain('FROM pass_credentials');
        expect(sql).toContain('FROM qr_passes_v2');
        return {
          rows: [{
            qr_id: 'qr-1',
            token: 'a'.repeat(32),
            pass_id: 'pass-1',
            pass_type: 'guest',
            subject_type: 'guest',
            valid_from: '2020-05-16T10:00:00.000Z',
            valid_until: '2099-05-16T12:00:00.000Z',
            status: 'active',
            access_request_id: 'ar-1',
            request_type: 'guest_access',
            visitor_name: 'Анна Курьер',
            guest_instructions: 'Вход через северный КПП',
            unit_number: '12',
            unit_type: 'apartment',
            access_point_name: 'КПП Север',
            access_zone_name: 'Паркинг',
            pin_public_display_allowed: false,
            resident_uid: 'must-not-leak',
            visitor_phone: '+79990001122',
          }],
        };
      }),
    };

    const res = await request(buildApp(db)).get(`/api/v1/public/pass/${'a'.repeat(32)}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      status: 'active',
      visitorName: 'Анна Курьер',
      propertyName: 'ЖК Замоскворечье',
      apartment: '12',
      destinationLabel: 'Квартира 12',
      validFrom: '2020-05-16T10:00:00.000Z',
      validUntil: '2099-05-16T12:00:00.000Z',
      type: 'Гостевой',
      passType: 'guest',
      accessPointName: 'КПП Север',
      accessZoneName: 'Паркинг',
      guestInstructions: 'Вход через северный КПП',
    }));
    expect(res.body).not.toHaveProperty('passId');
    expect(res.body.pinCredential).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain('must-not-leak');
    expect(JSON.stringify(res.body)).not.toContain('+79990001122');
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  test('falls back to legacy qr_passes for already shared 64-hex tokens', async () => {
    const db = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{
            pass_id: 'legacy-qr-1',
            token: 'b'.repeat(64),
            expires_at: '2099-05-16T12:00:00.000Z',
            used_at: null,
            invalidated_at: null,
            request_id: 'legacy-request-1',
            request_type: 'delivery',
            visitor_name: 'Курьер',
            apartment: '45',
            valid_until: '2099-05-16T12:00:00.000Z',
          }],
        }),
    };

    const res = await request(buildApp(db)).get(`/api/v1/public/pass/${'b'.repeat(64)}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      status: 'active',
      visitorName: 'Курьер',
      apartment: '45',
      destinationLabel: 'Квартира 45',
      validUntil: '2099-05-16T12:00:00.000Z',
      type: 'delivery',
      passType: 'delivery',
      accessPointName: null,
      accessZoneName: null,
    }));
    expect(res.body).not.toHaveProperty('passId');
    expect(db.query).toHaveBeenCalledTimes(2);
  });

  test('maps revoked and expired v1 pass states for public page', async () => {
    const db = {
      query: jest.fn(async () => ({
        rows: [{
          pass_id: 'pass-revoked',
          pass_type: 'guest',
          valid_from: '2026-05-16T10:00:00.000Z',
          valid_until: '2026-05-16T12:00:00.000Z',
          status: 'revoked',
          request_type: 'guest_access',
          visitor_name: 'Гость',
          unit_number: null,
          unit_type: null,
          access_point_name: null,
          access_zone_name: null,
        }],
      })),
    };

    const res = await request(buildApp(db)).get(`/api/v1/public/pass/${'c'.repeat(32)}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('revoked');
  });

  test('marks future v1 pass as pending instead of active', async () => {
    const db = {
      query: jest.fn(async () => ({
        rows: [{
          pass_id: 'pass-future',
          pass_type: 'guest',
          valid_from: '2099-05-16T10:00:00.000Z',
          valid_until: '2099-05-16T12:00:00.000Z',
          status: 'active',
          request_type: 'guest_access',
          visitor_name: 'Будущий гость',
          unit_number: '8',
          unit_type: 'apartment',
          access_point_name: null,
          access_zone_name: null,
        }],
      })),
    };

    const res = await request(buildApp(db)).get(`/api/v1/public/pass/${'d'.repeat(32)}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending');
    expect(res.body.validFrom).toBe('2099-05-16T10:00:00.000Z');
  });

  test('includes decrypted PIN only when public display is allowed by policy', async () => {
    const encrypted = encryptCredentialSecret('123456');
    const db = {
      query: jest.fn(async () => ({
        rows: [{
          pass_id: 'pass-pin',
          pass_type: 'guest',
          valid_from: '2020-05-16T10:00:00.000Z',
          valid_until: '2099-05-16T12:00:00.000Z',
          status: 'active',
          request_type: 'guest_access',
          visitor_name: 'Гость с PIN',
          unit_number: '3',
          unit_type: 'apartment',
          access_point_name: null,
          access_zone_name: null,
          pin_public_display_allowed: true,
          pin_render_version: 2,
          pin_expires_at: null,
          pin_credential_ciphertext: encrypted.credential_ciphertext,
          pin_credential_iv: encrypted.credential_iv,
          pin_credential_tag: encrypted.credential_tag,
        }],
      })),
    };

    const res = await request(buildApp(db)).get(`/api/v1/public/pass/${'e'.repeat(32)}`);

    expect(res.status).toBe(200);
    expect(res.body.pinCredential).toEqual({
      value: '123456',
      publicDisplayAllowed: true,
      renderVersion: 2,
      expiresAt: null,
    });
  });

  test('rejects unsupported token shapes as not found', async () => {
    const db = { query: jest.fn() };

    const res = await request(buildApp(db)).get('/api/v1/public/pass/not-a-token');

    expect(res.status).toBe(404);
    expect(db.query).not.toHaveBeenCalled();
  });
});
