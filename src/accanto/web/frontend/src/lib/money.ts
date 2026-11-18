/** Entered USD amounts: the API accepts one to nine whole digits and at most two decimals. */
export const USD_AMOUNT = /^\d{1,9}(\.\d{1,2})?$/;
export const SIGNED_USD_AMOUNT = /^-?\d{1,9}(\.\d{1,2})?$/;
