/**
 * Name pools for a placeless modern western town (D10, R7): names that read naturally in most western countries,
 * nothing tied to one country. Authoring data; extend freely (keep entries unique, and keep them
 * English-sounding: no names that point to one country's language).
 */

export const FEMALE_NAMES = [
  'Anna', 'Clara', 'Emma', 'Hannah', 'Laura', 'Grace', 'Ruby', 'Mia', 'Sophie', 'Julia', 'Sarah', 'Eva', 'Nora',
  'Ella', 'Lisa', 'Maria', 'Helen', 'Ruth', 'Alice', 'Rose', 'Ida', 'Megan', 'Paula', 'Holly', 'Nina', 'Vera', 'Olivia',
  'Amelia', 'Isabel', 'Lucy', 'Abigail', 'Elena', 'Katie', 'Beth', 'Tessa', 'Eleanor', 'Irene', 'Agnes', 'Martha',
  'Edith', 'Diana', 'Carla', 'Monica', 'Sandra', 'Claire', 'Susan', 'Karen', 'Linda', 'Margaret', 'Judith', 'Esther',
  'Miriam', 'Emily', 'Charlotte', 'Zoe', 'Chloe', 'Maya', 'Phoebe', 'Sofia', 'Valerie', 'Bianca', 'Rachel', 'Naomi',
  'Fiona', 'Celia', 'Hazel', 'Iris', 'Jasmine', 'Lydia', 'Stella',
] as const;

export const MALE_NAMES = [
  'Ben', 'David', 'Felix', 'James', 'Leo', 'Lucas', 'Max', 'Noah', 'Paul', 'Tom', 'Daniel', 'Simon', 'Jacob', 'Elliot',
  'Henry', 'Oscar', 'Theo', 'Adam', 'Martin', 'Peter', 'Thomas', 'Michael', 'Andrew', 'Steven', 'Frank', 'Robert',
  'Walter', 'Ernest', 'Charles', 'Edward', 'Victor', 'Oliver', 'Samuel', 'Nathan', 'Anthony', 'Ethan', 'Finn', 'Owen',
  'Julian', 'Toby', 'Matthew', 'Philip', 'George', 'Arthur', 'Albert', 'Frederick', 'Hugo', 'Ian', 'Joseph',
  'Connor', 'Liam', 'Mason', 'Nick', 'Patrick', 'Rafael', 'Sebastian', 'Tim', 'Vincent', 'William', 'Xavier',
  'Alex', 'Chris', 'Dennis', 'Eric', 'Gabriel', 'Harold', 'John', 'Kevin', 'Luke', 'Mark',
] as const;

export const SURNAMES = [
  'Adams', 'Baker', 'Bell', 'Bennett', 'Brandt', 'Brook', 'Carter', 'Clark', 'Cole', 'Dale', 'Ellis', 'Bishop', 'Chapman',
  'Fisher', 'Ford', 'Frank', 'Graham', 'Gray', 'Hale', 'Hart', 'Hayes', 'Hill', 'Harper', 'Hughes', 'Jennings', 'Knight',
  'Kemp', 'Lambert', 'Mason', 'Mills', 'Lawson', 'Morgan', 'Norris', 'Marsh', 'Parker', 'Palmer', 'Miller', 'Moss', 'Nash',
  'Nolan', 'Pearce', 'Park', 'Riley', 'Porter', 'Reed', 'Russell', 'Ross', 'Saunders', 'Spencer', 'Sutton', 'Tanner', 'Shaw',
  'Stone', 'Turner', 'Thorne', 'Warren', 'Webb', 'Walsh', 'Wheeler', 'West', 'Winter', 'Ward', 'Wood', 'Young', 'Yates',
  'Barnes', 'Barker', 'Bowen', 'Blake', 'Collins', 'Cooper', 'Dixon', 'Elliott', 'Fowler', 'Grant', 'Garner', 'Hunt', 'Hooper',
  'Kent', 'Ingram', 'Lane', 'Lowe', 'Lowry', 'Newman', 'Oakley', 'Price', 'Quinn', 'Rhodes', 'Pratt', 'Rowe', 'Sharp',
  'Vance', 'Wells', 'Tate', 'Abbott', 'Upton', 'Croft', 'Vaughn', 'Egan', 'Fleming', 'Walker', 'Holt', 'Irwin',
] as const;

export const PET_NAMES = [
  'Bella', 'Max', 'Luna', 'Charlie', 'Milo', 'Daisy', 'Rocky', 'Molly', 'Buddy', 'Coco', 'Felix', 'Nala', 'Oscar',
  'Lucky', 'Rex', 'Rosie', 'Teddy', 'Ziggy', 'Pepper', 'Shadow', 'Ginger', 'Sunny', 'Biscuit', 'Bruno', 'Lola',
  'Smokey', 'Tiger', 'Misty', 'Benny', 'Polly', 'Duke', 'Maple', 'Juno', 'Otis', 'Pip', 'Hazel',
] as const;

/** Street name stems and suffixes for test towns (the planner names real towns). */
export const STREET_STEMS = [
  'Elm', 'Mill', 'Church', 'Station', 'Oak', 'River', 'Market', 'School', 'Park', 'Bridge', 'Garden', 'Hill', 'Lake',
  'Meadow', 'Linden', 'Chestnut', 'Willow', 'Birch', 'Castle', 'Orchard', 'Brook', 'Forest', 'Spring', 'Rose',
  'Maple', 'Ash', 'Cedar', 'Kings', 'Queens', 'North', 'South', 'East', 'West', 'Harbour', 'Field', 'Vine',
] as const;
export const STREET_SUFFIXES = ['Street', 'Road', 'Lane', 'Way', 'Avenue'] as const;
