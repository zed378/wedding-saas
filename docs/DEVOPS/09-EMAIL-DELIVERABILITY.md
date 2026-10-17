# 09 - Email Deliverability (SPF, DKIM, DMARC)

## Overview & Principles
Email deliverability is a core product requirement (P4-06, ADR-013). Transactional emails (account verification, password reset, payment confirmation, security alerts) that land in the spam folder represent silent product failures, and unauthenticated domains are open vectors for phishing attacks.

Per ADR-013, Momen Bahagia uses **Resend** as the transactional email provider behind the `EmailPort` abstraction. Before sending any production emails, the domain DNS records must be fully configured and verified.

---

## 1. Domain Configuration
All transactional emails are sent from `Momen Bahagia <halo@momenbahagia.id>` (or designated sending subdomain `bounces.momenbahagia.id` / `mail.momenbahagia.id` configured in Resend).

### A. SPF (Sender Policy Framework)
SPF designates which mail servers are authorized to send email on behalf of `momenbahagia.id`.

- **Type**: `TXT`
- **Host / Name**: `@` (or `momenbahagia.id`)
- **Value**:
  ```text
  v=spf1 include:amazonses.com include:resend.com ~all
  ```
- **Policy Explanation**:
  - `include:resend.com`: Authorizes Resend's sending infrastructure.
  - `~all` (SoftFail) during rollout transition, tightening to `-all` (HardFail) once all legitimate sources are catalogued.

### B. DKIM (DomainKeys Identified Mail)
DKIM provides cryptographic signature validation ensuring email headers and body have not been altered in transit.

Resend provides three distinct 2048-bit DKIM selectors via CNAME records:
- **Record 1**:
  - **Type**: `CNAME`
  - **Host / Name**: `resend._domainkey.momenbahagia.id`
  - **Value**: `dkim.resend.com`
- **Record 2 / 3**: (Provided in Resend Dashboard during domain verification)

### C. DMARC (Domain-based Message Authentication, Reporting, and Conformance)
DMARC links SPF and DKIM together and instructs receiving mail servers (Google Workspace, Yahoo, Apple Mail) on how to handle failures.

- **Type**: `TXT`
- **Host / Name**: `_dmarc.momenbahagia.id`
- **Value**:
  ```text
  v=DMARC1; p=reject; sp=reject; pct=100; rua=mailto:dmarc-rua@momenbahagia.id; ruf=mailto:dmarc-ruf@momenbahagia.id; fo=1;
  ```
- **Tags & Enforcement**:
  - `p=reject`: Highest security posture — completely drops unauthorized mail spoofing our brand.
  - `sp=reject`: Applies rejection policy to all subdomains as well.
  - `pct=100`: Applies to 100% of outbound messages.
  - `rua`: Aggregate reporting URI for automated deliverability analysis.
  - `ruf`: Forensic failure reporting for immediate spoofing investigation.

---

## 2. MX and Return-Path (Bounce Handling)
Custom return-path records capture asynchronous delivery bounces:
- **Type**: `MX`
- **Host / Name**: `bounces.momenbahagia.id`
- **Value**: `feedback-smtp.resend.com`
- **Priority**: `10`
- **Type**: `TXT`
- **Host / Name**: `bounces.momenbahagia.id`
- **Value**: `v=spf1 include:resend.com ~all`

---

## 3. Pre-flight Verification Commands

To verify DNS propagation and compliance locally or on VPS:

```bash
# Check SPF
dig TXT momenbahagia.id +short

# Check DKIM
dig CNAME resend._domainkey.momenbahagia.id +short

# Check DMARC
dig TXT _dmarc.momenbahagia.id +short

# Check Return-Path MX
dig MX bounces.momenbahagia.id +short
```

---

## 4. Monitoring & Deliverability Hygiene
1. **Google Postmaster Tools**: Register `momenbahagia.id` to track IP and domain reputation, spam rate (< 0.10%), and TLS adoption.
2. **One-Click Unsubscribe**: Unsubscribe headers (`List-Unsubscribe` and `List-Unsubscribe-Post`) must be included on all non-security notifications (RSVP, Guestbook).
3. **Security Non-Opt-Out**: Critical security notices (`password_changed`, `bank_account_changed`) are sent unconditionally without preference checks per ADR-025.
