// 4.3 Сумма каждого столбца, затем номер столбца с минимальной суммой
#include <iostream>
using namespace std;

int main() {
    const int N = 3;
    int a[N][N];
    cout << "Введите матрицу " << N << "x" << N << ":" << endl;
    for (int i = 0; i < N; i++)
        for (int j = 0; j < N; j++)
            cin >> a[i][j];

    int minSum = 0, minCol = 0;
    for (int j = 0; j < N; j++) {
        int sum = 0;
        for (int i = 0; i < N; i++)
            sum += a[i][j];
        cout << "Сумма столбца " << j + 1 << ": " << sum << endl;
        if (j == 0 || sum < minSum) {
            minSum = sum;
            minCol = j;
        }
    }

    cout << "Столбец с минимальной суммой: " << minCol + 1 << endl;
    return 0;
}
