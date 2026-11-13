// 非同期の仕事を、届いた順に 1 つずつ行う。前の仕事が失敗しても、次の仕事は行う。
export const serial = () => {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const p = tail.then(task);
    tail = p.catch(() => {});
    return p;
  };
};
