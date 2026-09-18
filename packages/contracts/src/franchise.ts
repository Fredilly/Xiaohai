import { z } from 'zod';

export const franchiseApplicationStatusSchema = z.enum([
  'SUBMITTED',
  'ASSIGNED',
  'FOLLOWING_UP',
  'APPROVED',
  'REJECTED',
  'SIGNED',
  'PREPARING',
  'OPENED',
  'CLOSED',
]);

export const franchiseFollowupChannelSchema = z.enum([
  'PHONE',
  'WECHAT',
  'EMAIL',
  'MEETING',
  'OTHER',
]);

export const createFranchiseApplicationRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    phone: z.string().trim().min(6).max(32),
    email: z.email().max(254).optional(),
    country: z.string().trim().min(1).max(120),
    region: z.string().trim().min(1).max(120),
    city: z.string().trim().min(1).max(120),
    district: z.string().trim().min(1).max(120).optional(),
    background: z.string().trim().max(2000).optional(),
    message: z.string().trim().max(2000).optional(),
  })
  .strict();

export const franchiseApplicationListQuerySchema = z
  .object({
    status: franchiseApplicationStatusSchema.optional(),
    assignedStaffAccountId: z.uuid().optional(),
    query: z.string().trim().min(1).max(120).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict();

export const assignFranchiseApplicationRequestSchema = z
  .object({
    staffAccountId: z.uuid(),
    version: z.number().int().positive(),
  })
  .strict();

export const createFranchiseFollowupRequestSchema = z
  .object({
    channel: franchiseFollowupChannelSchema,
    note: z.string().trim().min(1).max(4000),
    nextFollowupAt: z.iso.datetime().optional(),
    version: z.number().int().positive(),
  })
  .strict();

export const reviewFranchiseApplicationRequestSchema = z
  .object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    note: z.string().trim().max(4000).optional(),
    version: z.number().int().positive(),
  })
  .strict();

export const updateFranchiseApplicationStatusRequestSchema = z
  .object({
    status: z.enum(['SIGNED', 'PREPARING', 'OPENED', 'CLOSED']),
    version: z.number().int().positive(),
  })
  .strict();

export const franchiseFollowupSchema = z.object({
  id: z.uuid(),
  staffAccountId: z.uuid(),
  channel: franchiseFollowupChannelSchema,
  note: z.string(),
  nextFollowupAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
});

export const franchiseApplicationViewSchema = z.object({
  id: z.uuid(),
  applicationNumber: z.string(),
  submittedByConsumerUserId: z.uuid().nullable(),
  name: z.string(),
  phone: z.string(),
  email: z.string().nullable(),
  country: z.string(),
  region: z.string(),
  city: z.string(),
  district: z.string().nullable(),
  background: z.string().nullable(),
  message: z.string().nullable(),
  status: franchiseApplicationStatusSchema,
  assignedStaffAccountId: z.uuid().nullable(),
  reviewedByStaffAccountId: z.uuid().nullable(),
  reviewNote: z.string().nullable(),
  submittedAt: z.coerce.date(),
  assignedAt: z.coerce.date().nullable(),
  reviewedAt: z.coerce.date().nullable(),
  approvedAt: z.coerce.date().nullable(),
  rejectedAt: z.coerce.date().nullable(),
  signedAt: z.coerce.date().nullable(),
  preparingAt: z.coerce.date().nullable(),
  openedAt: z.coerce.date().nullable(),
  closedAt: z.coerce.date().nullable(),
  version: z.number().int().positive(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  followups: z.array(franchiseFollowupSchema),
});

export const franchiseApplicationListResponseSchema = z.object({
  items: z.array(franchiseApplicationViewSchema.omit({ followups: true })),
});

export type FranchiseApplicationStatus = z.infer<typeof franchiseApplicationStatusSchema>;
export type FranchiseFollowupChannel = z.infer<typeof franchiseFollowupChannelSchema>;
export type CreateFranchiseApplicationRequest = z.infer<
  typeof createFranchiseApplicationRequestSchema
>;
export type FranchiseApplicationListQuery = z.infer<typeof franchiseApplicationListQuerySchema>;
export type AssignFranchiseApplicationRequest = z.infer<
  typeof assignFranchiseApplicationRequestSchema
>;
export type CreateFranchiseFollowupRequest = z.infer<typeof createFranchiseFollowupRequestSchema>;
export type ReviewFranchiseApplicationRequest = z.infer<
  typeof reviewFranchiseApplicationRequestSchema
>;
export type UpdateFranchiseApplicationStatusRequest = z.infer<
  typeof updateFranchiseApplicationStatusRequestSchema
>;
export type FranchiseApplicationView = z.infer<typeof franchiseApplicationViewSchema>;
