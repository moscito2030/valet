export const seats = ['N', 'E', 'S', 'W'] as const;
export type Seat = typeof seats[number];
export type Board = { number: number; dealer: Seat; vulnerability: 'None' | 'NS' | 'EW' | 'All'; deal: Record<Seat, string[]> };
export type Result = { status?: string; assignmentId?: string; updatedAt?: string; miniBridge?: boolean; level: number; strain: string; doubled: number; declarer: Seat; tricks: number; lead: string; nsScore: number };
