// 4.1 Сумма главной диагонали и минимальный элемент побочной диагонали
#include <iostream>
using namespace std;

int main() {
    const int N = 3;
    int a[N][N];
    cout << "Введите матрицу " << N << "x" << N << ":" << endl;
    for (int i = 0; i < N; i++)
        for (int j = 0; j < N; j++)
            cin >> a[i][j];

    int sumMain = 0;
    int minSide = a[0][N - 1];
    for (int i = 0; i < N; i++) {
        sumMain += a[i][i];
        if (a[i][N - 1 - i] < minSide)
            minSide = a[i][N - 1 - i];
    }

    cout << "Сумма главной диагонали: " << sumMain << endl;
    cout << "Минимум побочной диагонали: " << minSide << endl;
    return 0;
}
