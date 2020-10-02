'use strict';
import {
  cryptoWaitReady,
  mnemonicGenerate,
  mnemonicToEntropy,
  mnemonicValidate,
  mnemonicToMiniSecret,
  schnorrkelKeypairFromSeed
} from '@polkadot/util-crypto';

import { sr25519Sign } from '@heystraightedge/wasm-crypto';
import { sha256 } from 'js-sha256';
import { fromHex, Bech32, toUtf8, toBase64 } from '@cosmjs/encoding';
import { Uint53, Decimal } from "@cosmjs/math";

import { assert, u8aToU8a } from '@polkadot/util';

import {
  Bip39,
  EnglishMnemonic,
  HdPath,
  Random,
  Secp256k1,
  Sha256,
  Slip10,
  Slip10Curve,
} from "@cosmjs/crypto";

var bigInt = require("big-integer");

import {
  LcdClient,
  CosmosClient,
  BroadcastMode,
  setupAuthExtension,
  setupBankExtension,
  makeCosmoshubPath,
  rawSecp256k1PubkeyToAddress,
  makeStdTx,
  Msg,
  Coin,
  isMsgSend,
  StdFee,
  makeSignDoc,
  serializeSignDoc,
  StdSignDoc,
} from "@cosmjs/launchpad";


const lcd_client = LcdClient.withExtensions(
  { apiUrl: "http://straightedge.rpc.sikka.tech:1318" },
  setupAuthExtension,
  setupBankExtension,
);

const cosmos_client = new CosmosClient(
  "http://straightedge.rpc.sikka.tech:1318",
  BroadcastMode.Sync,
);


function sortJson(json) {
  if (typeof json !== "object" || json === null) {
    return json;
  }
  if (Array.isArray(json)) {
    return json.map(sortJson);
  }
  const sortedKeys = Object.keys(json).sort();
  const result = sortedKeys.reduce(
    (accumulator, key) => ({
      ...accumulator,
      [key]: sortJson(json[key]),
    }),
    {},
  );
  return result;
}

/**
 * @name schnorrkelSign
 * @description Returns message signature of `message`, using the supplied pair
 */
function schnorrkelSign(message, {
  publicKey,
  secretKey
}) {
  (0, assert)((publicKey === null || publicKey === void 0 ? void 0 : publicKey.length) === 32, 'Expected a valid publicKey, 32-bytes');
  (0, assert)((secretKey === null || secretKey === void 0 ? void 0 : secretKey.length) === 64, 'Expected a valid secretKey, 64-bytes');
  const messageU8a = (0, u8aToU8a)(message);
  return (0, sr25519Sign)(publicKey, secretKey, messageU8a);
}

function encodeSrPubkey(pubkey) {
  return {
    type: "tendermint/PubKeySr25519",
    value: toBase64(pubkey),
  };
}

function encodeStdSignature(pubkey, raw_sig) {
  return {
    pub_key: encodeSrPubkey(pubkey),
    signature: toBase64(raw_sig),
  };
}

var real_balance;
var sr_addr;
var secp_addr;
var sr_keypair;

document.addEventListener('DOMContentLoaded', async () => {
  const importbutton = document.getElementById('importbtn');
  const sendbutton = document.getElementById('sendbtn');
  const textbox = document.getElementById('mnemonictxt');


  importbutton.addEventListener('click', async () => {
    var mnem = textbox.value;
    if (!mnemonicValidate(mnem)) {
      alert("Invalid mnemonic, please paste it into textbox.");
      return;
    }
    var password = "";
    var entropy = mnemonicToMiniSecret(mnem, password);
    sr_keypair = schnorrkelKeypairFromSeed(entropy);

    // Get sr25519 address
    var hash = sha256.create();
    hash.update(sr_keypair.publicKey);
    var sr_addr_hex = hash.hex();
    var sr_addr_bz = fromHex(sr_addr_hex).slice(0, 20);
    sr_addr = Bech32.encode("str", sr_addr_bz);
    console.log(sr_addr);

    // make secp256k1 address
    const mnemonicChecked = new EnglishMnemonic(mnem);
    const seed = await Bip39.mnemonicToSeed(mnemonicChecked);
    const { privkey } = Slip10.derivePath(Slip10Curve.Secp256k1, seed, makeCosmoshubPath(0));
    const pubkey_raw = (await Secp256k1.makeKeypair(privkey)).pubkey;
    secp_addr = rawSecp256k1PubkeyToAddress(Secp256k1.compressPubkey(pubkey_raw), "str");
    console.log(secp_addr);

    // Now we have the two correct addresses, we just need to get the balances.

    // Get sr25519 balance by RPC querying
    const balances = await lcd_client.bank.balances(sr_addr);
    console.log(balances);
    
    if (balances.result.length == 0) {
      alert("Could not find account for this mnemonic.");
      return;
    }


    real_balance = balances.result[0];
    console.log(real_balance);

    // Set new address and balance in UI
    const balstr = Decimal.fromAtomics(real_balance.amount, 18).toString();
    $("#balancetxt").html(balstr + "<span>STR</span>");
    $("#addresstxt").text(secp_addr);

    // Switch Tabs
    window.tabs.changeTab(1);
    $(".importpage").hide();
    $("#importpage").removeClass("on");
    $("#sendpage").show();
    $(".sendpage").show();
    $("#sendpage").addClass("on");
  });

  sendbutton.addEventListener('click', async () => {

    // Now we need to subract the fees
    // set memo / fees
    const memo = "sr25519 to secp key migration";


    // amount required is per what the RPC accepts
    const fee_coins = { denom: "astr", amount: "25000000000000000" };
    const fee = {
      amount: [fee_coins],
      gas: "100000",
    };

    
    // coin
    var bal_amt = Decimal.fromAtomics(real_balance.amount, 0)
    var fee_amt = Decimal.fromAtomics(fee_coins.amount, 0)
    if (bal_amt.isLessThan(fee_amt)) {
      alert("Insufficient balance to pay fees.");
      return;
    }
    var send_amt = bal_amt.minus(fee_amt);
    var coin = {
      denom: "astr",
      amount: send_amt.toString(),
    };

    // Now craft the send tx
    // First we get the message
    const sendMsg = {
      type: "cosmos-sdk/MsgSend",
      value: {
        from_address: sr_addr,
        to_address: secp_addr,
        amount: [coin],
      },
    };

    console.assert(isMsgSend(sendMsg));

    // get account / seqnum
    const { accountNumber, sequence } = await cosmos_client.getSequence(sr_addr);
    const chainId = "straightedge-2";

    // Build the message to sign over
    const msgs = [sendMsg];
    // const signDoc = makeSignDoc(msgs, fee, chainId, memo, accountNumber, sequence);
    const signDoc = {
      chain_id: chainId,
      account_number: Uint53.fromString(accountNumber.toString()).toString(),
      sequence: Uint53.fromString(sequence.toString()).toString(),
      fee: fee,
      msgs: msgs,
      memo: memo,
    };
    console.log(signDoc);
    // serializeSignDoc(signDoc)
    const sortedSignDoc = sortJson(signDoc);
    console.log(JSON.stringify(sortedSignDoc));
    const serializedDoc = toUtf8(JSON.stringify(sortedSignDoc));

    const sr_raw_sig = schnorrkelSign(serializedDoc, sr_keypair);
    console.log(sr_raw_sig);
    // Now we need to convert sr_raw_sig into a standard signature.
    const std_sig = encodeStdSignature(sr_keypair.publicKey, sr_raw_sig)
    console.log(std_sig);

    // const tx = makeStdTx(signDoc, sr_sig);
    const tx = {
      msg: signDoc.msgs,
      fee: signDoc.fee,
      memo: signDoc.memo,
      signatures: [std_sig],
    };
    console.log(tx);
    console.log(JSON.stringify(tx));

    console.log("sending tx");
    var result = await cosmos_client.postTx(tx);
    console.log(result);

  });
});