// src/users/users.types.ts
export type User = {
  id: string;
  provider: string;
  providerSub: string;
  email: string;
  emailVerified?: boolean;
  name?: string;
  picture?: string;
  createdAt: string;
  updatedAt: string;
};
