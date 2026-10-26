#!/usr/bin/env node
/**
 * Standalone Email Connectivity & Authentication Diagnostic Tool (Resend HTTPS API)
 * Run this directly in the Render shell or terminal to test outbound connectivity:
 *   node src/utils/testSmtpConnection.js
 *   or: node src/utils/testEmailConnection.js
 *
 * Checks:
 * 1. RESEND_API_KEY presence and format
 * 2. EMAIL_FROM configuration and testing vs custom domain
 * 3. Outbound HTTPS reachability to api.resend.com
 * 4. API Key authentication status
 *
 * Strictly NEVER prints credentials, API keys, or sensitive tokens.
 */

import { config } from '../config/env.js';
import { verifyEmailConnection, isEmailConfigured } from '../services/mailService.js';

async function runDiagnostic() {
  console.log('\n🔍 ========================================================');
  console.log('   CAMPUS BOOK EXCHANGE — RESEND EMAIL API DIAGNOSTIC      ');
  console.log('========================================================\n');

  const isConfigured = isEmailConfigured();
  const apiKey = config.email?.resendApiKey || '';
  const maskedKey = apiKey
    ? `${apiKey.slice(0, 5)}...${apiKey.slice(-4)}`
    : 'NOT_SET';
  const fromAddress = config.email?.from || 'Campus Book Exchange <onboarding@resend.dev>';
  const isTestingSender = fromAddress.includes('onboarding@resend.dev');

  console.log('📋 Resolved Configuration:');
  console.log(`   • Provider:        Resend HTTPS API`);
  console.log(`   • API Endpoint:    https://api.resend.com/emails`);
  console.log(`   • Port:            443 (Standard HTTPS — not blocked on Render Free)`);
  console.log(`   • From Address:    ${fromAddress}`);
  console.log(`   • Sender Mode:     ${isTestingSender ? 'Resend Testing Domain (onboarding@resend.dev)' : 'Custom Verified Domain'}`);
  console.log(`   • API Key Set:     ${Boolean(apiKey)} (${maskedKey})`);
  console.log(`   • Key Format:      ${apiKey.startsWith('re_') ? 'Valid prefix (re_)' : (apiKey ? 'Missing re_ prefix' : 'NOT_SET')}`);

  if (isTestingSender) {
    console.log('\n⚠️  TESTING SENDER NOTICE:');
    console.log('   When using onboarding@resend.dev, Resend ONLY permits sending emails');
    console.log('   to the email address registered to your Resend account.');
    console.log('   To send verification emails to any student address, add and verify');
    console.log('   your custom domain in Resend Dashboard -> Domains.');
  }

  if (!apiKey) {
    console.error('\n❌ CONFIGURATION ERROR:');
    console.error('   RESEND_API_KEY is not configured in environment.');
    console.error('   Please configure RESEND_API_KEY in your Render Dashboard -> Environment variables.');
    process.exit(1);
  }

  console.log('\n⏳ Initiating HTTPS connection test to api.resend.com...');
  const startTime = Date.now();

  try {
    const result = await verifyEmailConnection();
    const duration = Date.now() - startTime;

    if (result.success) {
      console.log(`\n✅ SUCCESS (Completed in ${duration}ms):`);
      console.log('   • HTTPS connection to api.resend.com established.');
      console.log('   • Resend API key authenticated successfully.');
      console.log('   • Ready to dispatch OTP verification and password reset emails!\n');
      process.exit(0);
    } else {
      console.error(`\n❌ VERIFICATION FAILED (after ${duration}ms):`);
      console.error(`   • Failure Stage: ${result.failureStage}`);
      console.error(`   • Error Code:    ${result.errorCode || 'N/A'}`);
      console.error(`   • Details:       ${result.details}`);

      if (result.failureStage === 'API_AUTHENTICATION') {
        console.error('\n💡 GUIDANCE FOR API AUTHENTICATION FAILURE:');
        console.error('   The RESEND_API_KEY was rejected by Resend.');
        console.error('   1. Log into https://resend.com/api-keys');
        console.error('   2. Create a new API key (Full Access or Sending Access)');
        console.error('   3. Update RESEND_API_KEY in your Render Dashboard environment variables.');
      } else if (result.failureStage === 'NETWORK_FAILURE') {
        console.error('\n💡 GUIDANCE FOR NETWORK FAILURE:');
        console.error('   Outbound HTTPS to api.resend.com failed or timed out.');
      }
      process.exit(1);
    }
  } catch (unexpectedError) {
    console.error('\n❌ UNEXPECTED ERROR DURING TEST:', unexpectedError.message);
    process.exit(1);
  }
}

runDiagnostic();
