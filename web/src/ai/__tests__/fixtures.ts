// Test data from spikes/nano/data.js (made up; the persona is "Alex Rivera") and the records of 10 section 15.
import type { Category, IndexRecord } from '@sieve/shared';

export const SUBJECTS: { from: string; subject: string; label: Category }[] = [
  { from: 'Oakview Property Management', subject: 'Re: Deposit for the apartment', label: 'Home' },
  { from: 'Oakview Property Management', subject: 'Maintenance request #4471: kitchen sink', label: 'Home' },
  { from: 'Oakview Property Management', subject: 'Your lease renewal offer for Unit 3B', label: 'Home' },
  { from: 'Riverside Power', subject: 'Your electricity bill for October is ready', label: 'Home' },
  { from: 'Building Concierge', subject: 'Package room: you have a delivery waiting', label: 'Home' },
  { from: 'Oakview Property Management', subject: 'Move-out checklist and inspection date', label: 'Home' },
  { from: 'Priya Nair', subject: 'Q4 planning: agenda for Thursday', label: 'Work' },
  { from: 'Ashgrove Recruiting', subject: 'Your interview with Ashgrove is confirmed', label: 'Work' },
  { from: 'Code Review Bot', subject: 'PR #212 needs your review', label: 'Work' },
  { from: 'Talent Team, Quillfield Labs', subject: 'Offer letter: Senior ML Engineer', label: 'Work' },
  { from: 'HR Operations', subject: 'Timesheet reminder: submit by Friday', label: 'Work' },
  { from: 'Marcus Lee', subject: 'Slides for the customer demo', label: 'Work' },
  { from: 'First Harbor Bank', subject: 'Your November statement is ready', label: 'Money' },
  { from: 'Payroll Services', subject: 'Your W-2 for 2025 is available', label: 'Money' },
  { from: 'PayFriend', subject: 'You paid Alex Kim $45.00', label: 'Money' },
  { from: 'Summit Card Services', subject: 'Unusual sign-in to your credit card account', label: 'Money' },
  { from: 'Evergreen Investing', subject: 'Your quarterly portfolio summary', label: 'Money' },
  { from: 'TaxFile Online', subject: 'Your federal tax return was accepted', label: 'Money' },
  { from: 'Lakeshore Credit Union', subject: 'Loan payment due on Nov 28', label: 'Money' },
  { from: 'First Harbor Bank', subject: 'Wire transfer confirmation', label: 'Money' },
  { from: 'Lakeside Medical Group', subject: 'Your test results are ready to view', label: 'Health' },
  { from: 'Lakeside Medical Group', subject: 'Appointment reminder: Dr. Patel, Tue 9:30 AM', label: 'Health' },
  { from: 'CornerCare Pharmacy', subject: 'Your prescription is ready for pickup', label: 'Health' },
  { from: 'Patient Portal', subject: 'New message from your care team', label: 'Health' },
  { from: 'BlueRiver Health Plan', subject: 'Explanation of benefits for your recent visit', label: 'Health' },
  { from: 'Bright Smile Dental', subject: 'Time to book your next cleaning', label: 'Health' },
  { from: 'Lakeside Lab Services', subject: 'Fasting required before your blood draw', label: 'Health' },
  { from: 'Lakeside Behavioral Health', subject: 'Following up on our conversation', label: 'Health' },
  { from: 'Skyline Air', subject: 'Your booking is confirmed: Chicago to Seattle', label: 'Travel' },
  { from: 'Skyline Air', subject: 'Check in now for flight SA 1432', label: 'Travel' },
  { from: 'Harbor Inn', subject: 'Hotel reservation: 2 nights', label: 'Travel' },
  { from: 'Metro Car Rental', subject: 'Your rental car pickup details', label: 'Travel' },
  { from: 'Conference Travel Desk', subject: 'Trip itinerary for the conference', label: 'Travel' },
  { from: 'Passport Services', subject: 'Passport renewal: application received', label: 'Travel' },
  { from: 'Larkspur Goods', subject: 'Your order has shipped', label: 'Shopping' },
  { from: 'Larkspur Goods', subject: 'Return label for order #88231', label: 'Shopping' },
  { from: 'Gadget Hub', subject: 'Delivered: wireless headphones', label: 'Shopping' },
  { from: 'Pantryline Grocers', subject: 'Receipt for your grocery order', label: 'Shopping' },
  { from: 'Birchway Home Supply', subject: 'Your pickup order is ready at the store', label: 'Shopping' },
  { from: 'Mom', subject: "Photos from Mom's birthday dinner", label: 'Personal' },
  { from: 'Jordan', subject: 'Are we still on for Saturday?', label: 'Personal' },
  { from: 'Sam and Jordan', subject: 'Wedding invitation: Sam & Jordan', label: 'Personal' },
  { from: 'Aunt Leela', subject: 'Happy birthday!!', label: 'Personal' },
  { from: 'Chris', subject: 'Fourth of July hot dog contest pictures', label: 'Personal' },
  { from: 'AI Weekly', subject: 'This week in AI: 5 papers worth reading', label: 'Newsletters' },
  { from: 'Neighborhood Forum', subject: 'Your weekly digest', label: 'Newsletters' },
  { from: 'Gadget Hub', subject: 'Black Friday deals start now', label: 'Newsletters' },
  { from: 'DevTalks', subject: 'Webinar: building with on-device AI', label: 'Newsletters' },
  { from: 'The Data Podcast', subject: 'New episode out now', label: 'Newsletters' },
  { from: 'Notely', subject: "Product update: what's new in November", label: 'Newsletters' },
];

export const BODIES = {
  deposit:
    'Hi Alex, thanks for your email. We received your security deposit of $1,200 on March 3. It will be returned within 30 days of move-out, minus any repair costs. Let me know your move-out date so we can schedule the inspection. Best, Dana, Oakview Property Management',
  flight:
    "Booking reference K7Q2LM. Flight SA 1432 departs Chicago O'Hare (ORD) on Friday, December 4 at 7:45 AM and arrives in Seattle (SEA) at 10:20 AM. Seat 14C. One checked bag included.",
  pets:
    '12. Pets. Tenant may keep one cat or one dog under 40 pounds with prior written approval from the Landlord. A non-refundable pet fee of $300 is due before the pet moves in. Exotic animals are not permitted.',
  missing: 'A package is waiting for you in the package room. Pick it up with your building key fob between 8 AM and 9 PM.',
};

const DAY = 24 * 3600 * 1000;
const BASE_DATE = new Date(2026, 2, 4, 9, 0).getTime();   // 2026-03-04 local

export function record(over: Partial<IndexRecord> & Pick<IndexRecord, 'id' | 'title'>): IndexRecord {
  const text = over.text;
  return {
    source: 'playground',
    sourceRef: over.id.split(':').slice(1).join(':'),
    kind: 'email',
    date: BASE_DATE,
    preview: (text ?? over.caption ?? '').slice(0, 280),
    category: 'Home',
    categoryBy: 'seed',
    hiddenRemoved: [],
    pii: [],
    sizeBytes: (text ?? '').length,
    indexedAt: BASE_DATE,
    contentHash: `hash-${over.id}`,
    version: 1,
    ...over,
  };
}

export const RECORDS = {
  deposit: record({
    id: 'playground:deposit', title: 'Re: Deposit for the apartment', from: 'Oakview Property Management <dana@oakview.example>',
    text: BODIES.deposit, category: 'Home',
  }),
  flight: record({
    id: 'playground:flight', title: 'Your booking is confirmed: Chicago to Seattle', from: 'Skyline Air <no-reply@skyline.example>',
    text: BODIES.flight, category: 'Travel', date: BASE_DATE + 30 * DAY,
  }),
  pets: record({ id: 'playground:pets', title: 'Lease_2026.pdf, section 12', kind: 'document', text: BODIES.pets, category: 'Home' }),
  missing: record({ id: 'playground:missing', title: 'Package room: you have a delivery waiting', from: 'Building Concierge', text: BODIES.missing, category: 'Home' }),
  health: record({
    id: 'playground:health', title: 'Your test results are ready to view', from: 'Lakeside Medical Group',
    text: 'Your recent lab results are now available in the patient portal.', category: 'Health',
  }),
  bank: record({
    id: 'playground:bank', title: 'Your November statement is ready', from: 'First Harbor Bank',
    text: 'Your November statement for account ending 4421 is ready. Closing balance: $3,204.18.', category: 'Money',
  }),
  photo: record({
    id: 'playground:IMG_4821.jpg', title: 'IMG_4821.jpg', kind: 'photo', category: 'Photos',
    caption: 'A man with five hot dogs in his mouth at a backyard party.', date: new Date(2025, 6, 4, 18, 0).getTime(),
  }),
};
