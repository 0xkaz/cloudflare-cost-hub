-- Store the full list of accounts a user authorized (JSON [{id,name}]) so they
-- can switch the active account after login. account_id remains the active one.
ALTER TABLE cf_oauth_tokens ADD COLUMN accounts TEXT;
