// This is mock data. Replace with API call to /api/courses.
export type Course = {
  id: string;
  month: string;
  grade: string;
  lectures: number;
  price: number;
  available: boolean;
  badge?: string;
  popular?: boolean;
  thumbnailKey?: string | null;
};

export const courses: Course[] = [];

// This is mock data. Replace with API call to /api/testimonials.
export const testimonials = [
  {
    name: 'محمد أحمد',
    grade: 'الصف الثالث الثانوي',
    text: 'طريقة الشرح خلتني أفهم الإنجليزي بدل ما أحفظه. بقيت داخل الامتحان واثق من نفسي.',
    rating: 5,
  },
  {
    name: 'نورا خالد',
    grade: 'الصف الثاني الثانوي',
    text: 'كل نقطة متقسمة ببساطة، والمراجعات وفرت عليا وقت كبير قبل الامتحان.',
    rating: 5,
  },
  {
    name: 'عمر سامي',
    grade: 'الصف الأول الثانوي',
    text: 'الحصة خفيفة وواضحة والأسئلة بعد كل درس بتثبت المعلومة فعلاً.',
    rating: 5,
  },
];

// This is mock data. Replace with API call to /api/teacher.
export const teacher = {
  name: 'مستر أحمد حسن',
  role: 'مدرس اللغة الإنجليزية للمرحلة الثانوية',
  bio: 'مؤسس إنجليزيكا، ومنهجنا إن الطالب يفهم اللغة ويستخدمها، مش يحفظ قواعدها وبس. بنشرح بطريقة منظمة وبسيطة، مع تدريب مستمر على شكل الامتحان.',
};
