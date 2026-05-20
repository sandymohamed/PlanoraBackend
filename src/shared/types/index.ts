import { Request } from 'express';
import { User } from '@prisma/client';

// Extend Express Request to include user
export interface AuthenticatedRequest extends Request {
  user?: User;
}

// JWT Payload
export interface JWTPayload {
  userId: string;
  email: string;
  iat?: number;
  exp?: number;
}

// API Response types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// Pagination
export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Sync types
export interface SyncOperation {
  id: string;
  entity: string;
  operation: 'create' | 'update' | 'delete';
  data: any;
  timestamp: number;
  version: number;
}

export interface SyncRequest {
  operations: SyncOperation[];
  lastSyncTimestamp: number;
}

export interface SyncResponse {
  operations: SyncOperation[];
  conflicts: SyncConflict[];
  serverTimestamp: number;
}

export interface SyncConflict {
  operationId: string;
  conflictType: 'version' | 'permission' | 'data';
  serverData: any;
  clientData: any;
  resolution: 'client' | 'server' | 'merge' | 'manual';
}

// Recurrence types
export interface RecurrenceRule {
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval?: number;
  byDay?: string[];
  byMonthDay?: number[];
  byMonth?: number[];
  bySetPos?: number[];
  count?: number;
  until?: Date;
  rrule?: string; // RFC 5545 RRULE string
}

// Location types
export interface GeoLocation {
  latitude: number;
  longitude: number;
  radius: number; // in meters
  onEnter: boolean;
  onExit: boolean;
}

// Notification types
export interface NotificationPayload {
  title: string;
  body: string;
  data?: any;
  sound?: string;
  badge?: number;
}

// AI Plan Generator types
export interface PlanGenerationRequest {
  goalId: string;
  promptOptions?: {
    intensity?: 'low' | 'medium' | 'high';
    weeklyHours?: number;
    language?: 'en' | 'ar';
    tone?: 'supportive' | 'professional' | 'casual';
  };
}

export interface GeneratedMilestone {
  title: string;
  durationDays: number; // Fallback if targetDate is not provided
  targetDate?: string; // ISO date string - preferred if provided by AI
  description?: string;
  tasks: string[];
}

export interface GeneratedTask {
  title: string;
  milestoneIndex: number;
  dueOffsetDays: number;
  durationMinutes: number;
  recurrence?: string;
  description?: string;
}

export interface GeneratedPlan {
  milestones: GeneratedMilestone[];
  tasks: GeneratedTask[];
  notes?: string;
}

// Analytics types
export interface AnalyticsSummary {
  period: '7d' | '30d' | '90d' | '1y';
  tasksCompleted: number;
  tasksCreated: number;
  goalsCompleted: number;
  goalsCreated: number;
  productivityScore: number;
  averageTaskCompletionTime: number;
  mostProductiveDay: string;
  mostProductiveTime: string;
  categoryBreakdown: {
    category: string;
    count: number;
    percentage: number;
  }[];
}

// File upload types
export interface FileUpload {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

// WebSocket event types
export interface WebSocketEvents {
  'task-created': { task: any; projectId: string };
  'task-updated': { task: any; projectId: string };
  'task-deleted': { taskId: string; projectId: string };
  'comment-added': { comment: any; taskId: string; projectId: string };
  'member-added': { member: any; projectId: string };
  'member-removed': { memberId: string; projectId: string };
  'member-role-changed': { member: any; projectId: string };
}

// Error types
export class AppError extends Error {
  public statusCode: number;
  public isOperational: boolean;
  public code?: string;
  public field?: string;

  constructor(
    message: string,
    statusCode: number = 500,
    isOperational: boolean = true,
    code?: string,
    field?: string
  ) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.code = code;
    this.field = field;
    this.name = this.constructor.name;

    Error.captureStackTrace(this, this.constructor);
  }
}

// Validation error (invalid input)
export class ValidationError extends AppError {
  constructor(message: string, field?: string) {
    super(message, 400, true, 'VALIDATION_ERROR', field);
  }
}

// Conflict (e.g. duplicate email)
export class ConflictError extends AppError {
  constructor(message: string, code: string = 'CONFLICT', field?: string) {
    super(message, 409, true, code, field);
  }
}

// Authentication error (login, invalid token)
export class AuthenticationError extends AppError {
  constructor(
    message: string = 'Invalid email or password. Check your credentials or create an account.',
    code: string = 'INVALID_CREDENTIALS'
  ) {
    super(message, 401, true, code);
  }
}

// Authorization error
export class AuthorizationError extends AppError {
  constructor(message: string = 'Insufficient permissions', code: string = 'FORBIDDEN') {
    super(message, 403, true, code);
  }
}

// Not found error
export class NotFoundError extends AppError {
  constructor(resource: string = 'Resource', code: string = 'NOT_FOUND') {
    super(`${resource} not found`, 404, true, code);
  }
}
