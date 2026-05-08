'use strict';

const { normalizePlate } = require('../lib/normalizePlate');

const PROPERTY_TYPES = new Set(['residential_complex', 'club_house', 'cottage_community']);
const UNIT_TYPES = new Set(['apartment', 'townhouse', 'house', 'commercial', 'utility']);
const COTTAGE_UNIT_TYPES = new Set(['house', 'townhouse', 'utility']);
const RESIDENT_TYPES = new Set(['owner', 'tenant', 'family_member']);
const CHECKPOINT_TYPES = new Set(['checkpoint', 'gate', 'barrier', 'service_gate', 'wicket']);
const PHONE_RE = /^\+?\d{8,15}$/;

const CSV_TEMPLATES = Object.freeze({
  residential_complex: [
    'building',
    'entrance',
    'unit_number',
    'floor',
    'full_name',
    'phone',
    'resident_type',
    'vehicle_plates',
  ],
  club_house: [
    'building',
    'entrance',
    'unit_number',
    'floor',
    'full_name',
    'phone',
    'resident_type',
    'vehicle_plates',
  ],
  cottage_community: [
    'sector_or_street',
    'house_or_plot_number',
    'unit_type',
    'owner_full_name',
    'phone',
    'resident_type',
    'vehicle_plates',
    'checkpoint_name',
    'checkpoint_type',
    'checkpoint_notes',
  ],
});

const CSV_SAMPLE_ROWS = Object.freeze({
  residential_complex: [
    'Корпус 1',
    'Подъезд 2',
    '42',
    '8',
    'Иванов Иван',
    '+79991234567',
    'owner',
    'А001АА77;В002ВВ77',
  ],
  club_house: [
    'Дом A',
    'Вход 1',
    '12',
    '3',
    'Иванов Иван',
    '+79991234567',
    'owner',
    'А001АА77',
  ],
  cottage_community: [
    'Северная улица',
    '14',
    'house',
    'Иванов Иван',
    '+79991234567',
    'owner',
    'А001АА77',
    'КПП 1',
    'checkpoint',
    'Основной въезд',
  ],
});

class StructureImportError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.name = 'StructureImportError';
    this.status = status;
    this.details = details;
  }
}

function isStructureImportError(err) {
  return err instanceof StructureImportError;
}

function importError(status, message, details = null) {
  return new StructureImportError(status, message, details);
}

function normalizePropertyType(value) {
  return PROPERTY_TYPES.has(value) ? value : 'residential_complex';
}

function csvEscape(value) {
  const str = String(value ?? '');
  if (!/[",\n\r]/.test(str)) return str;
  return `"${str.replace(/"/g, '""')}"`;
}

function buildImportTemplate(propertyTypeInput) {
  const propertyType = normalizePropertyType(propertyTypeInput);
  const header = CSV_TEMPLATES[propertyType];
  const sample = CSV_SAMPLE_ROWS[propertyType];
  return {
    property_type: propertyType,
    filename: `domhub-${propertyType}-units-import.csv`,
    content: `${header.map(csvEscape).join(',')}\n${sample.map(csvEscape).join(',')}\n`,
  };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => String(cell).trim() !== ''));
}

function parseCsvRows(text) {
  if (typeof text !== 'string' || !text.trim()) {
    throw importError(400, 'csv body is empty');
  }
  const rows = parseCsv(text);
  if (rows.length < 2) throw importError(400, 'csv must include header and at least one data row');
  const headers = rows[0].map((h) => String(h).trim());
  return rows.slice(1).map((row) => {
    const out = {};
    headers.forEach((header, idx) => {
      out[header] = row[idx] ?? '';
    });
    return out;
  });
}

function parseImportRowsInput(body) {
  if (typeof body === 'string') return parseCsvRows(body);
  if (Array.isArray(body)) return body;
  if (body && typeof body === 'object') {
    if (Array.isArray(body.rows)) return body.rows;
    if (typeof body.csv === 'string') return parseCsvRows(body.csv);
  }
  throw importError(400, 'import payload must be CSV text, { csv }, or { rows }');
}

function firstString(row, keys) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function parseFloor(value, rowNumber) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw importError(400, `row ${rowNumber}: floor must be integer or empty`);
  }
  return parsed;
}

function normalizeUnitType(row, propertyType, rowNumber) {
  const raw = firstString(row, ['unit_type']);
  const fallback = propertyType === 'cottage_community'
    ? 'house'
    : propertyType === 'club_house'
      ? 'apartment'
      : 'apartment';
  const unitType = raw || fallback;
  if (!UNIT_TYPES.has(unitType)) {
    throw importError(400, `row ${rowNumber}: invalid unit_type`);
  }
  if (propertyType === 'cottage_community' && !COTTAGE_UNIT_TYPES.has(unitType)) {
    throw importError(400, `row ${rowNumber}: cottage unit_type must be house, townhouse, or utility`);
  }
  return unitType;
}

function normalizeResidentType(row, rowNumber) {
  const residentType = firstString(row, ['resident_type']) || 'owner';
  if (!RESIDENT_TYPES.has(residentType)) {
    throw importError(400, `row ${rowNumber}: invalid resident_type`);
  }
  return residentType;
}

function splitVehiclePlates(value, rowNumber) {
  if (value === undefined || value === null || String(value).trim() === '') return [];
  const parts = String(value)
    .split(/[;|,\n]+/)
    .map((p) => normalizePlate(p))
    .filter(Boolean);
  for (const plate of parts) {
    if (plate.length < 3 || plate.length > 20) {
      throw importError(400, `row ${rowNumber}: invalid vehicle plate`);
    }
  }
  return [...new Set(parts)];
}

function normalizeImportRows({ propertyType, rows }) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw importError(400, 'rows must contain at least one import row');
  }
  if (rows.length > 1000) {
    throw importError(400, 'rows limit is 1000');
  }

  return rows.map((row, idx) => {
    const rowNumber = idx + 2;
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw importError(400, `row ${rowNumber}: must be an object`);
    }

    const buildingName = propertyType === 'cottage_community'
      ? firstString(row, ['sector_or_street', 'sector', 'street', 'building'])
      : firstString(row, ['building', 'building_name', 'sector_or_street']);
    const entranceName = propertyType === 'cottage_community'
      ? 'Без подъезда'
      : firstString(row, ['entrance', 'entrance_name']) || 'Основной вход';
    const unitNumber = propertyType === 'cottage_community'
      ? firstString(row, ['house_or_plot_number', 'unit_number', 'house_number', 'plot_number'])
      : firstString(row, ['unit_number', 'apartment', 'house_or_plot_number']);
    const fullName = firstString(row, ['owner_full_name', 'full_name', 'resident_full_name']);
    const phone = firstString(row, ['phone']);

    if (!buildingName) throw importError(400, `row ${rowNumber}: building or sector is required`);
    if (!unitNumber) throw importError(400, `row ${rowNumber}: unit or house number is required`);
    if (!fullName) throw importError(400, `row ${rowNumber}: resident full name is required`);
    if (!PHONE_RE.test(phone)) {
      throw importError(400, `row ${rowNumber}: phone must be E.164-like (+ and 8-15 digits)`);
    }

    const checkpointName = firstString(row, ['checkpoint_name']);
    const checkpointType = firstString(row, ['checkpoint_type']);
    if (checkpointType && !CHECKPOINT_TYPES.has(checkpointType)) {
      throw importError(400, `row ${rowNumber}: invalid checkpoint_type`);
    }

    return {
      rowNumber,
      buildingName,
      buildingCode: propertyType === 'cottage_community' ? buildingName : buildingName,
      entranceName,
      entranceCode: propertyType === 'cottage_community' ? 'virtual' : entranceName,
      unitNumber,
      unitType: normalizeUnitType(row, propertyType, rowNumber),
      floor: parseFloor(row.floor, rowNumber),
      fullName,
      phone,
      residentType: normalizeResidentType(row, rowNumber),
      vehiclePlates: splitVehiclePlates(firstString(row, ['vehicle_plates']), rowNumber),
      checkpoint: checkpointName
        ? {
          name: checkpointName,
          point_type: checkpointType || 'checkpoint',
          notes: firstString(row, ['checkpoint_notes']) || null,
        }
        : null,
    };
  });
}

function dedupePlannedAccessPoints(rows) {
  const seen = new Set();
  const planned = [];
  for (const row of rows) {
    if (!row.checkpoint) continue;
    const key = `${row.checkpoint.name}|${row.checkpoint.point_type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    planned.push(row.checkpoint);
  }
  return planned;
}

function buildReadiness(propertyType, rows, plannedAccessPoints) {
  if (propertyType !== 'cottage_community') {
    return { ready: true, homes_plots: rows.length, vehicles: null, planned_access_points: null };
  }
  const vehicles = rows.reduce((sum, row) => sum + row.vehiclePlates.length, 0);
  return {
    ready: rows.length > 0 && vehicles > 0 && plannedAccessPoints.length > 0,
    homes_plots: rows.length,
    vehicles,
    planned_access_points: plannedAccessPoints.length,
  };
}

async function ensureBuilding(queryable, propertyId, row) {
  const { rows } = await queryable.query(
    `SELECT id FROM buildings WHERE property_id = $1 AND code = $2 LIMIT 1`,
    [propertyId, row.buildingCode],
  );
  if (rows[0]) return { id: rows[0].id, created: false };
  const inserted = await queryable.query(
    `INSERT INTO buildings(property_id, code, name)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [propertyId, row.buildingCode, row.buildingName],
  );
  return { id: inserted.rows[0].id, created: true };
}

async function ensureEntrance(queryable, buildingId, row) {
  const { rows } = await queryable.query(
    `SELECT id FROM entrances WHERE building_id = $1 AND code = $2 LIMIT 1`,
    [buildingId, row.entranceCode],
  );
  if (rows[0]) return { id: rows[0].id, created: false };
  const inserted = await queryable.query(
    `INSERT INTO entrances(building_id, code, name)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [buildingId, row.entranceCode, row.entranceName],
  );
  return { id: inserted.rows[0].id, created: true };
}

async function ensureUnit(queryable, propertyId, buildingId, entranceId, row) {
  const { rows } = await queryable.query(
    `SELECT id FROM units
      WHERE property_id = $1 AND building_id = $2 AND entrance_id = $3 AND unit_number = $4
      LIMIT 1`,
    [propertyId, buildingId, entranceId, row.unitNumber],
  );
  if (rows[0]) return { id: rows[0].id, created: false };
  const inserted = await queryable.query(
    `INSERT INTO units(property_id, building_id, entrance_id, unit_number, unit_type, floor)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [propertyId, buildingId, entranceId, row.unitNumber, row.unitType, row.floor],
  );
  return { id: inserted.rows[0].id, created: true };
}

async function ensureResident(queryable, propertyId, unitId, row) {
  const { rows } = await queryable.query(
    `SELECT id FROM residents
      WHERE property_id = $1 AND unit_id = $2 AND phone = $3 AND full_name = $4 AND is_active = true
      LIMIT 1`,
    [propertyId, unitId, row.phone, row.fullName],
  );
  if (rows[0]) return { id: rows[0].id, created: false };
  const inserted = await queryable.query(
    `INSERT INTO residents(property_id, unit_id, full_name, phone, resident_type)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [propertyId, unitId, row.fullName, row.phone, row.residentType],
  );
  return { id: inserted.rows[0].id, created: true };
}

async function ensureVehicle(queryable, propertyId, residentId, plate) {
  const { rows } = await queryable.query(
    `SELECT id FROM vehicles WHERE property_id = $1 AND plate_number = $2 LIMIT 1`,
    [propertyId, plate],
  );
  if (rows[0]) return { id: rows[0].id, created: false };
  const inserted = await queryable.query(
    `INSERT INTO vehicles(
       property_id, owner_type, owner_resident_id, plate_number, vehicle_type, is_whitelisted, notes
     )
     VALUES ($1, 'resident', $2, $3, 'car', true, $4)
     RETURNING id`,
    [propertyId, residentId, plate, 'Imported during property onboarding'],
  );
  return { id: inserted.rows[0].id, created: true };
}

async function ensureAccessZone(queryable, propertyId, point, sortOrder) {
  const { rows } = await queryable.query(
    `SELECT id, name, zone_type FROM access_zones
      WHERE property_id = $1 AND LOWER(name) = LOWER($2) AND is_active = true
      LIMIT 1`,
    [propertyId, point.name],
  );
  if (rows[0]) {
    return {
      id: rows[0].id,
      name: rows[0].name,
      zone_type: rows[0].zone_type,
      created: false,
    };
  }

  const inserted = await queryable.query(
    `INSERT INTO access_zones(property_id, name, zone_type, description, sort_order, metadata)
     VALUES ($1, $2, 'checkpoint', $3, $4, $5::jsonb)
     RETURNING id, name, zone_type`,
    [
      propertyId,
      point.name,
      point.notes,
      sortOrder,
      JSON.stringify({ source: 'onboarding_import', planned_point_type: point.point_type }),
    ],
  );
  return {
    id: inserted.rows[0].id,
    name: inserted.rows[0].name,
    zone_type: inserted.rows[0].zone_type,
    created: true,
  };
}

async function ensureAccessPoint(queryable, propertyId, zoneId, point, sortOrder) {
  const { rows } = await queryable.query(
    `SELECT id, zone_id, name, point_type FROM access_points
      WHERE property_id = $1
        AND zone_id = $2
        AND LOWER(name) = LOWER($3)
        AND point_type = $4
        AND is_active = true
      LIMIT 1`,
    [propertyId, zoneId, point.name, point.point_type],
  );
  if (rows[0]) {
    return {
      id: rows[0].id,
      zone_id: rows[0].zone_id,
      name: rows[0].name,
      point_type: rows[0].point_type,
      notes: point.notes,
      created: false,
    };
  }

  const inserted = await queryable.query(
    `INSERT INTO access_points(
       property_id, zone_id, name, point_type, description, sort_order, metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     RETURNING id, zone_id, name, point_type`,
    [
      propertyId,
      zoneId,
      point.name,
      point.point_type,
      point.notes,
      sortOrder,
      JSON.stringify({ source: 'onboarding_import' }),
    ],
  );
  return {
    id: inserted.rows[0].id,
    zone_id: inserted.rows[0].zone_id,
    name: inserted.rows[0].name,
    point_type: inserted.rows[0].point_type,
    notes: point.notes,
    created: true,
  };
}

async function provisionAccessTopology(queryable, propertyId, plannedAccessPoints) {
  const zones = [];
  const points = [];

  for (const [idx, point] of plannedAccessPoints.entries()) {
    const sortOrder = idx + 1;
    const zone = await ensureAccessZone(queryable, propertyId, point, sortOrder);
    const accessPoint = await ensureAccessPoint(queryable, propertyId, zone.id, point, sortOrder);
    zones.push(zone);
    points.push(accessPoint);
  }

  return { zones, points };
}

async function importStructureRows({ queryable, propertyId, propertyType, body }) {
  const parsedRows = parseImportRowsInput(body);
  const normalizedRows = normalizeImportRows({ propertyType, rows: parsedRows });
  const plannedAccessPoints = dedupePlannedAccessPoints(normalizedRows);
  const readiness = buildReadiness(propertyType, normalizedRows, plannedAccessPoints);
  const warnings = [];
  if (propertyType === 'cottage_community' && readiness.vehicles === 0) {
    warnings.push('cottage_community vehicle baseline is missing');
  }
  if (propertyType === 'cottage_community' && readiness.planned_access_points === 0) {
    warnings.push('cottage_community planned checkpoint/gate is missing');
  }

  const imported = { buildings: 0, entrances: 0, units: 0, residents: 0, vehicles: 0 };
  const skipped = { buildings: 0, entrances: 0, units: 0, residents: 0, vehicles: 0 };
  const rowResults = [];

  for (const row of normalizedRows) {
    const building = await ensureBuilding(queryable, propertyId, row);
    imported.buildings += building.created ? 1 : 0;
    skipped.buildings += building.created ? 0 : 1;

    const entrance = await ensureEntrance(queryable, building.id, row);
    imported.entrances += entrance.created ? 1 : 0;
    skipped.entrances += entrance.created ? 0 : 1;

    const unit = await ensureUnit(queryable, propertyId, building.id, entrance.id, row);
    imported.units += unit.created ? 1 : 0;
    skipped.units += unit.created ? 0 : 1;

    const resident = await ensureResident(queryable, propertyId, unit.id, row);
    imported.residents += resident.created ? 1 : 0;
    skipped.residents += resident.created ? 0 : 1;

    const vehicleIds = [];
    for (const plate of row.vehiclePlates) {
      const vehicle = await ensureVehicle(queryable, propertyId, resident.id, plate);
      imported.vehicles += vehicle.created ? 1 : 0;
      skipped.vehicles += vehicle.created ? 0 : 1;
      vehicleIds.push(vehicle.id);
    }

    rowResults.push({
      row: row.rowNumber,
      building_id: building.id,
      entrance_id: entrance.id,
      unit_id: unit.id,
      resident_id: resident.id,
      vehicle_ids: vehicleIds,
    });
  }

  const accessTopology = await provisionAccessTopology(queryable, propertyId, plannedAccessPoints);

  return {
    imported,
    skipped,
    warnings,
    planned_access_points: plannedAccessPoints,
    access_topology: accessTopology,
    readiness,
    rows: rowResults,
  };
}

module.exports = {
  StructureImportError,
  buildImportTemplate,
  importStructureRows,
  isStructureImportError,
  normalizePropertyType,
  parseCsvRows,
};
