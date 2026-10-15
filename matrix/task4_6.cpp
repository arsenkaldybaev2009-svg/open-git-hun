// 4.6 Транспонированная матрица
#include <iostream>
using namespace std;

int main() {
    const int N = 3;
    int a[N][N];
    cout << "Введите матрицу " << N << "x" << N << ":" << endl;
    for (int i = 0; i < N; i++)
        for (int j = 0; j < N; j++)
            cin >> a[i][j];

    cout << "Транспонированная матрица:" << endl;
    for (int i = 0; i < N; i++) {
        for (int j = 0; j < N; j++)
            cout << a[j][i] << " ";
        cout << endl;
    }
    return 0;
}
