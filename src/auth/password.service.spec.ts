import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const passwords = new PasswordService();

  it('creates salted scrypt hashes and verifies only the original password', async () => {
    const first = await passwords.hash('correct horse battery staple');
    const second = await passwords.hash('correct horse battery staple');
    expect(first).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(first).not.toBe(second);
    expect(first).not.toContain('correct horse battery staple');
    await expect(passwords.verify('correct horse battery staple', first)).resolves.toBe(true);
    await expect(passwords.verify('wrong horse battery staple', first)).resolves.toBe(false);
  });

  it('fails closed for missing and malformed stored hashes', async () => {
    await expect(passwords.verify('anything', null)).resolves.toBe(false);
    await expect(passwords.verify('anything', 'not-a-password-hash')).resolves.toBe(false);
  });
});
