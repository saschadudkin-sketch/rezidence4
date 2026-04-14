'use strict';

const REQUEST_FIELD_MAX = Object.freeze({
  visitorName: 200,
  visitorPhone: 30,
  carPlate: 20,
  comment: 2000,
  historyLabel: 200,
});

const USER_FIELD_MAX = Object.freeze({
  name: 100,
  apartment: 20,
});

const BLACKLIST_FIELD_MAX = Object.freeze({
  name: 200,
  phone: 30,
  carPlate: 20,
  reason: 500,
});

const PERMS_LIMITS = Object.freeze({
  maxItems: 500,
  maxPayloadBytes: 50_000,
  name: 200,
  phone: 30,
});

const TEMPLATE_LIMITS = Object.freeze({
  maxItems: 200,
  maxPayloadBytes: 50_000,
  name: 100,
});

const CHAT_LIMITS = Object.freeze({
  text: 4000,
  photoUrl: 2048,
  reactionKey: 10,
});

module.exports = {
  REQUEST_FIELD_MAX,
  USER_FIELD_MAX,
  BLACKLIST_FIELD_MAX,
  PERMS_LIMITS,
  TEMPLATE_LIMITS,
  CHAT_LIMITS,
};
