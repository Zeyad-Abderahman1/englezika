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
};

export const courses: Course[] = [
  { id: "sep-3", month: "شهر سبتمبر", grade: "تالتة ثانوي", lectures: 8, price: 150, available: true, badge: "الأكثر مبيعاً", popular: true },
  { id: "oct-3", month: "شهر أكتوبر", grade: "تالتة ثانوي", lectures: 8, price: 150, available: true },
  { id: "nov-3", month: "شهر نوفمبر", grade: "تالتة ثانوي", lectures: 8, price: 150, available: false, badge: "قريباً" },
  { id: "sep-2", month: "شهر سبتمبر", grade: "تانية ثانوي", lectures: 6, price: 120, available: true },
  { id: "sep-1", month: "شهر سبتمبر", grade: "أولى ثانوي", lectures: 6, price: 100, available: true, badge: "جديد" },
  { id: "grammar-2", month: "تأسيس الجرامر", grade: "تانية ثانوي", lectures: 10, price: 180, available: true },
];

// This is mock data. Replace with API call to /api/testimonials.
export const testimonials = [
  { name: "محمد أحمد", grade: "الصف الثالث الثانوي", text: "طريقة الشرح خلتني أفهم الإنجليزي بدل ما أحفظه. بقيت داخل الامتحان واثق من نفسي.", rating: 5 },
  { name: "نورا خالد", grade: "الصف الثاني الثانوي", text: "كل نقطة متقسمة ببساطة، والمراجعات وفرت عليا وقت كبير قبل الامتحان.", rating: 5 },
  { name: "عمر سامي", grade: "الصف الأول الثانوي", text: "الحصة خفيفة وواضحة والأسئلة بعد كل درس بتثبت المعلومة فعلاً.", rating: 5 },
];

// This is mock data. Replace with API call to /api/teacher.
export const teacher = {
  name: "مستر أحمد حسن",
  role: "مدرس اللغة الإنجليزية للمرحلة الثانوية",
  bio: "مؤسس إنجليزيكا، ومنهجنا إن الطالب يفهم اللغة ويستخدمها، مش يحفظ قواعدها وبس. بنشرح بطريقة منظمة وبسيطة، مع تدريب مستمر على شكل الامتحان.",
};
