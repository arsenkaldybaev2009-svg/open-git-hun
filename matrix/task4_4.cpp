// 4.4 Сумма элементов выше и сумма ниже главной диагонали
#include <iostream>
using namespace std;

int main() {
    const int N = 3;
    int a[N][N];
    cout << "Введите матрицу " << N << "x" << N << ":" << endl;
    for (int i = 0; i < N; i++)
        for (int j = 0; j < N; j++)
            cin >> a[i][j];

    int above = 0, below = 0;
    for (int i = 0; i < N; i++)
        for (int j = 0; j < N; j++) {
            if (j > i) above += a[i][j];
            else if (j < i) below += a[i][j];
        }

    cout << "Сумма выше главной диагонали: " << above << endl;
    cout << "Сумма ниже главной диагонали: " << below << endl;
    return 0;
}
