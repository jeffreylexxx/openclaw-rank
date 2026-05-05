# Security Specification for OpenClaw Review System

## 1. Data Invariants
- Votes must be positive integers.
- Vote counts can only be incremented, not decremented or reset by unauthorized users.
- Metadata (ranking history) is intended for the application to persist its state, but in a pure client-side app, we must be careful. For this demo, we allow the client to update history.

## 2. Dirty Dozen Payloads (Targeting for Denial)
1. `{"voteRecommend": -1}` - Negative votes.
2. `{"voteRecommend": 999999999}` - Spamming high numbers in one go (should use increment).
3. `{"otherField": "hacked"}` - Adding shadow fields.
4. `{"versions": []}` - Clearing historical data.
5. `{"version": "../path/to/root"}` - ID Poisoning.

## 3. Test Runner (Draft)
A separate test file will verify these.
